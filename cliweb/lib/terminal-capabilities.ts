import { createHash, randomBytes } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { realpath, stat, readFile } from "fs/promises";
import { buildCliwebEnvironment } from "./runtime-environment";
import { listKnownTerminals } from "./terminal-registry";
import { isValidTerminalGrid } from "./terminal-grid";

const execFileAsync = promisify(execFile);
const SESSION_SEPARATOR = "%%";
const CAPABILITY_TTL_MS = 60_000;
const MAX_CAPABILITIES = 512;

interface TmuxServerIncarnation {
  pid: number;
  startTime: string;
}

interface TerminalCapability {
  sessionId: string;
  server: TmuxServerIncarnation;
  cwd: string;
  roots: string[];
  expiresAt: number;
}

// Route handlers are bundled by Next separately from the custom WebSocket
// server. Keep capabilities on process-global state so both module copies
// issue and consume from the same one-use store.
type CapabilityGlobal = typeof globalThis & {
  __cliwebTerminalCapabilitiesV1?: Map<string, TerminalCapability>;
};
const capabilityGlobal = globalThis as CapabilityGlobal;
const capabilities =
  (capabilityGlobal.__cliwebTerminalCapabilitiesV1 ??=
    new Map<string, TerminalCapability>());

async function runTmux(args: string[]): Promise<string> {
  const environment = buildCliwebEnvironment();
  delete environment.TMUX;
  delete environment.TMUX_PANE;
  const { stdout } = await execFileAsync("tmux", args, {
    env: environment,
    timeout: 3_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function serverIncarnation(): Promise<TmuxServerIncarnation> {
  const rawPid = await runTmux(["display-message", "-p", "#{pid}"]);
  const pid = Number(rawPid);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Could not identify the tmux server");
  }

  // Linux starttime distinguishes a restarted server when the kernel reuses
  // its PID. This app runs in a Linux container in development and production.
  const statLine = await readFile(`/proc/${pid}/stat`, "utf8");
  const closeParen = statLine.lastIndexOf(")");
  if (closeParen < 0) throw new Error("Could not identify the tmux server");
  const fieldsAfterComm = statLine.slice(closeParen + 2).trim().split(/\s+/);
  const startTime = fieldsAfterComm[19]; // proc stat field 22, starttime
  if (!startTime) throw new Error("Could not identify the tmux server");
  return { pid, startTime };
}

async function liveSessionId(name: string): Promise<string | null> {
  let sessions: string;
  try {
    sessions = await runTmux([
      "list-sessions",
      "-F",
      `#{session_name}${SESSION_SEPARATOR}#{session_id}`,
    ]);
  } catch {
    return null;
  }

  for (const line of sessions.split("\n")) {
    const splitAt = line.lastIndexOf(SESSION_SEPARATOR);
    if (splitAt < 0 || line.slice(0, splitAt) !== name) continue;
    const id = line.slice(splitAt + SESSION_SEPARATOR.length).trim();
    if (/^\$\d+$/.test(id)) return id;
  }
  return null;
}

async function sessionIdIsLive(sessionId: string): Promise<boolean> {
  try {
    const sessions = await runTmux(["list-sessions", "-F", "#{session_id}"]);
    return sessions.split("\n").includes(sessionId);
  } catch {
    return false;
  }
}

async function canonicalDirectory(path: string): Promise<string> {
  const canonical = await realpath(path);
  const info = await stat(canonical);
  if (!info.isDirectory()) throw new Error("Terminal root is not a directory");
  return canonical;
}

async function capabilityRoots(cwd: string): Promise<string[]> {
  const environment = buildCliwebEnvironment();
  const requestedRoots = [cwd, environment.TMPDIR, "/tmp"].filter(
    (path): path is string => Boolean(path)
  );
  const canonicalRoots: string[] = [];
  for (const path of requestedRoots) {
    const canonical = await canonicalDirectory(path);
    if (!canonicalRoots.includes(canonical)) canonicalRoots.push(canonical);
  }
  return canonicalRoots;
}

function capabilityKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sameIncarnation(
  left: TmuxServerIncarnation,
  right: TmuxServerIncarnation
): boolean {
  return left.pid === right.pid && left.startTime === right.startTime;
}

/** Create a random, single-use capability for a currently live tmux session. */
export async function issueTerminalCapability(
  sessionName: string
): Promise<string> {
  const name = sessionName.trim();
  if (!name || name.length > 256 || /[\r\n\0]/u.test(name)) {
    throw new Error("Invalid terminal session name");
  }

  const terminals = await listKnownTerminals();
  const terminal = terminals.find((candidate) => candidate.name === name);
  if (!terminal?.alive) throw new Error("Terminal session is not live");

  const sessionId = await liveSessionId(name);
  if (!sessionId) throw new Error("Terminal session is not live");

  const cwd = await canonicalDirectory(terminal.path);
  const roots = await capabilityRoots(cwd);
  const server = await serverIncarnation();
  const now = Date.now();
  for (const [key, entry] of capabilities) {
    if (entry.expiresAt <= now) capabilities.delete(key);
  }
  if (capabilities.size >= MAX_CAPABILITIES) {
    throw new Error("Too many pending terminal capabilities");
  }

  const token = randomBytes(32).toString("base64url");
  capabilities.set(capabilityKey(token), {
    sessionId,
    server,
    cwd,
    roots,
    expiresAt: now + CAPABILITY_TTL_MS,
  });
  return token;
}

/** Consume a token once, then revalidate the server, session and roots. */
export async function consumeTerminalCapability(
  token: unknown,
  dimensions: unknown
): Promise<TerminalCapability | null> {
  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(token) ||
    !isValidTerminalGrid(dimensions)
  ) {
    return null;
  }

  const key = capabilityKey(token);
  const entry = capabilities.get(key);
  capabilities.delete(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;

  try {
    const [currentServer, live, currentRoots] = await Promise.all([
      serverIncarnation(),
      sessionIdIsLive(entry.sessionId),
      capabilityRoots(entry.cwd),
    ]);
    if (!live || !sameIncarnation(entry.server, currentServer)) return null;
    if (
      currentRoots.length !== entry.roots.length ||
      currentRoots.some((root, index) => root !== entry.roots[index])
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return entry;
}
