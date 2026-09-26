import { createHash, randomBytes } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { constants } from "fs";
import { open, realpath, stat, readFile, type FileHandle } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { buildCliboxEnvironment } from "./runtime-environment";
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

export interface TerminalCapabilityRoot {
  path: string;
  handle: FileHandle;
  device: number;
  inode: number;
  temporary: boolean;
}

export interface TerminalCapability {
  sessionId: string;
  server: TmuxServerIncarnation;
  cwd: string;
  roots: string[];
  temporaryRoots: string[];
  rootDescriptors: TerminalCapabilityRoot[];
  urlImagesEnabled: boolean;
  expiresAt: number;
}

// Route handlers are bundled by Next separately from the custom WebSocket
// server. Keep capabilities on process-global state so both module copies
// issue and consume from the same one-use store.
type CapabilityGlobal = typeof globalThis & {
  __cliboxTerminalCapabilitiesV1?: Map<string, TerminalCapability>;
};
const capabilityGlobal = globalThis as CapabilityGlobal;
const capabilities = (capabilityGlobal.__cliboxTerminalCapabilitiesV1 ??=
  new Map<string, TerminalCapability>());

async function runTmux(args: string[]): Promise<string> {
  const environment = buildCliboxEnvironment();
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
  const fieldsAfterComm = statLine
    .slice(closeParen + 2)
    .trim()
    .split(/\s+/);
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

async function sessionUrlImagesEnabled(sessionId: string): Promise<boolean> {
  try {
    return (
      (await runTmux([
        "show-option",
        "-qv",
        "-t",
        sessionId,
        "@clibox_wterm_url_image",
      ])) === "1"
    );
  } catch {
    return false;
  }
}

export function expandHomePath(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

async function canonicalDirectory(path: string): Promise<string> {
  const environment = buildCliboxEnvironment();
  const home = environment.HOME || homedir();
  const canonical = await realpath(expandHomePath(path, home));
  const info = await stat(canonical);
  if (!info.isDirectory()) throw new Error("Terminal root is not a directory");
  return canonical;
}

async function temporaryRoots(): Promise<string[]> {
  const environment = buildCliboxEnvironment();
  const requestedRoots = [environment.TMPDIR, "/tmp"].filter(
    (path): path is string => Boolean(path)
  );
  const canonicalRoots: string[] = [];
  for (const path of requestedRoots) {
    const canonical = await canonicalDirectory(path);
    if (!canonicalRoots.includes(canonical)) canonicalRoots.push(canonical);
  }
  return canonicalRoots;
}

async function capabilityRoots(
  cwd: string,
  temporary: string[]
): Promise<string[]> {
  return [cwd, ...temporary.filter((path) => path !== cwd)];
}

async function openCapabilityRoots(
  roots: string[],
  temporary: string[]
): Promise<TerminalCapabilityRoot[]> {
  const descriptors: TerminalCapabilityRoot[] = [];
  try {
    for (const path of roots) {
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      );
      try {
        const info = await handle.stat();
        if (!info.isDirectory())
          throw new Error("Terminal root is not a directory");
        descriptors.push({
          path,
          handle,
          device: info.dev,
          inode: info.ino,
          temporary: temporary.includes(path),
        });
      } catch (error) {
        await handle.close().catch(() => {});
        throw error;
      }
    }
    return descriptors;
  } catch (error) {
    await Promise.all(
      descriptors.map(({ handle }) => handle.close().catch(() => {}))
    );
    throw error;
  }
}

async function closeCapabilityRoots(entry: TerminalCapability): Promise<void> {
  await Promise.all(
    entry.rootDescriptors.map(({ handle }) => handle.close().catch(() => {}))
  );
}

async function capabilityRootsAreCurrent(
  entry: TerminalCapability
): Promise<boolean> {
  if (entry.rootDescriptors.length !== entry.roots.length) return false;
  for (const root of entry.rootDescriptors) {
    const [openInfo, currentPath, currentInfo] = await Promise.all([
      root.handle.stat(),
      realpath(root.path),
      stat(root.path),
    ]);
    if (
      currentPath !== root.path ||
      !currentInfo.isDirectory() ||
      openInfo.dev !== root.device ||
      openInfo.ino !== root.inode ||
      currentInfo.dev !== root.device ||
      currentInfo.ino !== root.inode
    ) {
      return false;
    }
  }
  return true;
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
  const temporary = await temporaryRoots();
  const roots = await capabilityRoots(cwd, temporary);
  const [server, urlImagesEnabled] = await Promise.all([
    serverIncarnation(),
    sessionUrlImagesEnabled(sessionId),
  ]);
  const now = Date.now();
  for (const [key, entry] of capabilities) {
    if (entry.expiresAt <= now) {
      capabilities.delete(key);
      await closeCapabilityRoots(entry);
    }
  }
  if (capabilities.size >= MAX_CAPABILITIES) {
    throw new Error("Too many pending terminal capabilities");
  }

  const rootDescriptors = await openCapabilityRoots(roots, temporary);

  const token = randomBytes(32).toString("base64url");
  capabilities.set(capabilityKey(token), {
    sessionId,
    server,
    cwd,
    roots,
    temporaryRoots: temporary,
    rootDescriptors,
    urlImagesEnabled,
    expiresAt: now + CAPABILITY_TTL_MS,
  });
  const key = capabilityKey(token);
  const entry = capabilities.get(key)!;
  const expiryTimer = setTimeout(() => {
    if (capabilities.get(key) !== entry) return;
    capabilities.delete(key);
    void closeCapabilityRoots(entry);
  }, CAPABILITY_TTL_MS + 1);
  expiryTimer.unref?.();
  return token;
}

export async function releaseTerminalCapability(
  capability: TerminalCapability
): Promise<void> {
  await closeCapabilityRoots(capability);
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
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    await closeCapabilityRoots(entry);
    return null;
  }

  try {
    const [currentServer, live, currentTemporaryRoots] = await Promise.all([
      serverIncarnation(),
      sessionIdIsLive(entry.sessionId),
      temporaryRoots(),
    ]);
    const currentRoots = await capabilityRoots(
      entry.cwd,
      currentTemporaryRoots
    );
    if (!live || !sameIncarnation(entry.server, currentServer)) {
      await closeCapabilityRoots(entry);
      return null;
    }
    if (
      currentRoots.length !== entry.roots.length ||
      currentRoots.some((root, index) => root !== entry.roots[index]) ||
      currentTemporaryRoots.length !== entry.temporaryRoots.length ||
      currentTemporaryRoots.some(
        (root, index) => root !== entry.temporaryRoots[index]
      ) ||
      !(await capabilityRootsAreCurrent(entry))
    ) {
      await closeCapabilityRoots(entry);
      return null;
    }
  } catch {
    await closeCapabilityRoots(entry);
    return null;
  }

  return entry;
}
