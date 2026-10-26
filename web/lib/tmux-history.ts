/**
 * A terminal's scrollback, fetched in one piece for the browser to scroll
 * locally.
 *
 * Scrolling a shell through tmux costs a network round trip per line; the
 * view can only run ahead of the text by a fraction of a row, so a fast
 * swipe outruns it. The browser instead asks for the history up front and
 * scrolls a local copy at the display's frame rate. Only a plain shell
 * qualifies: a full-screen app (alternate screen), a pane already in copy
 * mode, or a split window keep the live path.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { buildCliboxEnvironment } from "./runtime-environment";

const execFileAsync = promisify(execFile);

export const MAX_HISTORY_LINES = 5000;

// An inline TUI can leave tmux's alternate-screen flag off. Only a shell's
// scrollback can be presented as a local history view; a command such as
// Claude, less, or a REPL owns its current screen even when alternate_on=0.
const SHELL_COMMANDS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ash",
  "ksh",
  "mksh",
  "csh",
  "tcsh",
  "nu",
  "pwsh",
  "powershell",
  "elvish",
  "xonsh",
]);
const PANE_STATE_FORMAT =
  "#{alternate_on} #{pane_in_mode} #{window_panes} #{history_size} #{pane_height} #{pane_current_command}";

export type PaneHistory =
  | { available: false }
  | {
      available: true;
      /** Oldest first; the last `height` lines are the visible screen. */
      lines: string[];
      height: number;
      /** tmux's history size when captured, to line up later captures. */
      historySize: number;
    };

function tmuxEnv(): NodeJS.ProcessEnv {
  const env = buildCliboxEnvironment();
  delete env.TMUX;
  delete env.TMUX_PANE;
  return env;
}

async function tmuxOutput(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("tmux", args, {
      env: tmuxEnv(),
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

/** Parses tmux's `display-message` answer; exported for tests. */
export function parsePaneState(out: string | null): {
  shell: boolean;
  historySize: number;
  height: number;
} | null {
  if (!out) return null;
  const [alternate, inMode, panes, history, height, command] = out
    .trim()
    .split(/\s+/);
  const historySize = Number(history);
  const rows = Number(height);
  if (
    !Number.isInteger(historySize) ||
    !Number.isInteger(rows) ||
    rows <= 0 ||
    !command
  ) {
    return null;
  }
  return {
    shell:
      alternate === "0" &&
      inMode === "0" &&
      panes === "1" &&
      SHELL_COMMANDS.has(command),
    historySize,
    height: rows,
  };
}

export async function capturePaneHistory(
  session: string,
  maxLines: number
): Promise<PaneHistory> {
  const state = parsePaneState(
    await tmuxOutput([
      "display-message",
      "-p",
      "-t",
      session,
      PANE_STATE_FORMAT,
    ])
  );
  if (!state?.shell) return { available: false };

  const history = Math.min(
    state.historySize,
    Math.max(0, Math.min(maxLines, MAX_HISTORY_LINES))
  );
  // -e keeps colours; lines are captured as displayed (wrapped), which is
  // what the browser lays out row by row.
  const out = await tmuxOutput([
    "capture-pane",
    "-p",
    "-e",
    "-t",
    session,
    "-S",
    String(-history),
    "-E",
    String(state.height - 1),
  ]);
  if (out === null) return { available: false };
  // A shell may launch a TUI while capture-pane is in flight. Returning that
  // mixed screen as shell history makes the first swipe flash older content.
  const after = parsePaneState(
    await tmuxOutput([
      "display-message",
      "-p",
      "-t",
      session,
      PANE_STATE_FORMAT,
    ])
  );
  if (
    !after?.shell ||
    after.height !== state.height ||
    after.historySize !== state.historySize
  )
    return { available: false };
  const lines = out.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length !== history + state.height) return { available: false };
  return {
    available: true,
    lines,
    height: state.height,
    historySize: state.historySize,
  };
}
