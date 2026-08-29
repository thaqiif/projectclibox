/**
 * Terminals.
 *
 * A terminal is backed by tmux, and tmux is the only place its existence is
 * recorded. There used to be a `sessions` row mirroring each one, which
 * meant two sources of truth that drifted whenever a terminal was started
 * outside the app, killed from the CLI, or lost during a server restart.
 *
 * This workspace does not identify or launch installed CLIs. A terminal is
 * always represented as a shell, even if the user later runs another command
 * inside it.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { buildCliwebEnvironment } from "./runtime-environment";

const execFileAsync = promisify(execFile);

/**
 * tmux mangles "\t" into "_" when the server runs without a UTF-8 locale,
 * which is how terminal listing silently came back empty once before. A
 * literal two-character separator survives any locale.
 */
const SEP = "%%";

export interface Terminal {
  /** tmux name; the terminal's identity. */
  name: string;
  /** Working directory of the terminal. */
  path: string;
  /** tmux's last-activity stamp, in seconds. */
  activity: number;
  /** Whether any client is currently attached. */
  attached: boolean;
  /** Number of tmux panes, so the UI can show that a terminal is split. */
  panes: number;
}

async function tmux(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("tmux", args, {
      env: buildCliwebEnvironment(),
    });
    return stdout;
  } catch {
    // No server running, or the terminal vanished between calls. Both are
    // ordinary states, not errors.
    return "";
  }
}

/**
 * tmux servers keep their own environment. Explicitly seed each new session
 * so a server created before a package install still sees persistent tools.
 */
export function tmuxSessionEnvironmentArgs(
  input: Record<string, string | undefined> = process.env
): string[] {
  const environment = buildCliwebEnvironment(input);

  return [
    "PATH",
    "HOME",
    "NPM_CONFIG_PREFIX",
    "NPM_CONFIG_USERCONFIG",
    "PYTHONUSERBASE",
    "CLIWEB_NANOBREW_ROOT",
    "SHELL",
    "USER",
    "LOGNAME",
  ].flatMap((key) => ["-e", `${key}=${environment[key]}`]);
}

/**
 * Count panes in each terminal. Installed commands are intentionally ignored.
 *
 * One `list-panes -a` covers every terminal, so this stays a single tmux
 * call however many terminals are open.
 */
async function paneCounts(): Promise<Map<string, number>> {
  const out = await tmux(["list-panes", "-a", "-F", "#{session_name}"]);
  const counts = new Map<string, number>();

  for (const name of out.split("\n")) {
    if (!name.trim()) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return counts;
}

export async function listTerminals(): Promise<Terminal[]> {
  const out = await tmux([
    "list-sessions",
    "-F",
    `#{session_name}${SEP}#{session_path}${SEP}#{session_activity}${SEP}#{session_attached}`,
  ]);

  if (!out.trim()) return [];

  const panes = await paneCounts();
  const terminals: Terminal[] = [];

  for (const line of out.split("\n")) {
    if (!line.trim()) continue;

    // Split from the right: a terminal name may contain the separator, a
    // path is far less likely to and the trailing fields never do.
    const parts = line.split(SEP);
    if (parts.length < 4) continue;

    const attached = parts.pop()!;
    const activity = parts.pop()!;
    const path = parts.pop()!;
    const name = parts.join(SEP);

    terminals.push({
      name,
      path,
      activity: parseInt(activity, 10) || 0,
      attached: attached.trim() !== "0",
      panes: panes.get(name) ?? 1,
    });
  }

  return terminals;
}

/**
 * Whether a terminal by exactly this name exists.
 *
 * Deliberately not `has-session`: tmux target names are prefix- and
 * pattern-matched, so `has-session -t v1` answers yes for a terminal called
 * `v1_2_0`. A rename collision check that loose would refuse valid names
 * and, worse, a tmux target lookup would hand back the wrong terminal.
 */
export async function terminalExists(name: string): Promise<boolean> {
  return (await tmuxTerminalId(name)) !== null;
}

/**
 * Create a terminal.
 *
 * It starts as a plain shell. The UI never chooses or auto-detects a CLI.
 */
export async function createTerminal(cwd: string): Promise<Terminal> {
  const name = `term-${randomUUID()}`;
  const environment = buildCliwebEnvironment();

  await execFileAsync(
    "tmux",
    [
      "new-session",
      "-d",
      ...tmuxSessionEnvironmentArgs(environment),
      "-s",
      name,
      "-c",
      cwd,
    ],
    { env: environment }
  );

  // Mouse mode makes tmux's own splits usable in the browser: scrolling,
  // pane focus and divider dragging all work without a prefix key.
  await tmux(["set-option", "-t", name, "mouse", "on"]);

  // The status bar duplicates what the workbench already shows, and eats a
  // row of the interactive program. Global, so hand-started terminals lose it too.
  await tmux(["set-option", "-g", "status", "off"]);

  return {
    name,
    path: cwd,
    activity: Math.floor(Date.now() / 1000),
    attached: false,
    panes: 1,
  };
}

/**
 * Client-facing shape.
 *
 * Field names deliberately mirror what the sidebar and cards already read,
 * so the list UI did not have to be rewritten alongside the data source.
 * `id` is the tmux name: a terminal has no other identity.
 */
export interface TerminalRecord {
  id: string;
  name: string;
  tmux_name: string;
  working_directory: string;
  project_id: string | null;
  panes: number;
  attached: boolean;
  activity: number;
  /** False when the tmux terminal is gone; selecting it starts one again. */
  alive: boolean;
}

export function toRecord(
  terminal: Terminal,
  projectId: string | null,
  alive = true
): TerminalRecord {
  return {
    id: terminal.name,
    name: terminal.name,
    tmux_name: terminal.name,
    working_directory: terminal.path,
    project_id: projectId,
    panes: terminal.panes,
    attached: terminal.attached,
    activity: terminal.activity,
    alive,
  };
}

export async function killTerminal(name: string): Promise<void> {
  await execFileAsync("tmux", ["kill-session", "-t", name]);
}

/**
 * A terminal name tmux will accept unchanged.
 *
 * tmux uses "." and ":" to address windows and panes, so it rewrites both
 * to "_" in a terminal name — silently, with a zero exit code. Renaming a
 * terminal to "v1.2.0" therefore left tmux holding "v1_2_0" while we
 * recorded "v1.2.0": the entry went stale, and the real terminal came back
 * on the next listing as a second, unexplained terminal.
 *
 * Applying the same rule up front means the name we show is the name that
 * exists. `renameTerminal` still reads the result back from tmux, so we
 * stay correct even if this rule and tmux's ever diverge.
 */
export function sanitizeTerminalName(name: string): string {
  return name.trim().replace(/[.:]/g, "_");
}

/**
 * tmux's own id for a terminal (`$3`), which survives a rename.
 *
 * Renaming by name is a race with itself: once tmux has rewritten the name,
 * neither the old nor the requested name addresses the terminal any more.
 * Resolved from the listing rather than a target, so the match is exact.
 */
async function tmuxTerminalId(name: string): Promise<string | null> {
  const out = await tmux([
    "list-sessions",
    "-F",
    `#{session_name}${SEP}#{session_id}`,
  ]);

  for (const line of out.split("\n")) {
    const idx = line.lastIndexOf(SEP);
    if (idx === -1) continue;
    if (line.slice(0, idx) === name) return line.slice(idx + SEP.length).trim();
  }

  return null;
}

/**
 * Rename a live terminal, returning the name tmux actually gave it.
 *
 * Throws if the terminal is gone or tmux refuses the name — the caller must
 * not update its own records unless this succeeds.
 */
export async function renameTerminal(
  name: string,
  newName: string
): Promise<string> {
  const id = await tmuxTerminalId(name);
  if (!id) throw new Error(`No tmux terminal named "${name}"`);

  await execFileAsync("tmux", ["rename-session", "-t", id, newName]);

  const actual = await tmux([
    "display-message",
    "-p",
    "-t",
    id,
    "#{session_name}",
  ]);
  return actual.trim() || newName;
}
