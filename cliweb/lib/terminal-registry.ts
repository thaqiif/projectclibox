/**
 * Terminal registry.
 *
 * tmux stays the source of truth for what is *running*. This module adds
 * the one thing tmux cannot tell us: that a terminal exists at all after
 * its tmux process has been killed.
 *
 * Without it, killing the last tmux terminal made the terminal disappear
 * from the sidebar with no way to get it back. Now the entry survives,
 * marked not-alive, and selecting it starts tmux again in the same working
 * directory under the same name.
 *
 * A terminal is forgotten only when the user explicitly closes it. Anything
 * else — a crash, a reboot, `tmux kill-server` — leaves it restartable.
 */

import { getDb, queries, type TerminalRow } from "@/lib/db";
import { listTerminals, type Terminal } from "@/lib/terminals";

/** A terminal, whether or not tmux currently has a process for it. */
export interface KnownTerminal extends Terminal {
  /** False when the tmux process is gone and selecting it would restart it. */
  alive: boolean;
}

export function rememberTerminal(name: string, cwd: string): void {
  queries.rememberTerminal(getDb()).run(name, cwd);
}

export function forgetTerminal(name: string): void {
  queries.forgetTerminal(getDb()).run(name);
}

export function renameTerminalRow(name: string, newName: string): void {
  queries.renameTerminalRow(getDb()).run(newName, name);
}

/** Whether the registry already has an entry under this name. */
export function terminalRowExists(name: string): boolean {
  const rows = queries.getAllTerminals(getDb()).all() as TerminalRow[];
  return rows.some((r) => r.name === name);
}

/** Working directory last recorded for a terminal, if we know it. */
export function terminalWorkingDirectory(name: string): string | null {
  const rows = queries.getAllTerminals(getDb()).all() as TerminalRow[];
  return rows.find((r) => r.name === name)?.working_directory ?? null;
}

/**
 * Every terminal: live tmux terminals first, then registry entries whose
 * process is gone.
 *
 * Live terminals are folded back into the registry as we go, so a terminal
 * started outside CLIWeb (`tmux new` in a shell) becomes a first-class
 * terminal that survives being killed, exactly like one we created.
 */
export async function listKnownTerminals(): Promise<KnownTerminal[]> {
  const live = await listTerminals();
  const db = getDb();

  for (const terminal of live) {
    queries.rememberTerminal(db).run(terminal.name, terminal.path);
  }

  const rows = queries.getAllTerminals(db).all() as TerminalRow[];
  const liveByName = new Map(live.map((t) => [t.name, t]));

  const known: KnownTerminal[] = [];

  for (const row of rows) {
    const running = liveByName.get(row.name);

    if (running) {
      known.push({ ...running, alive: true });
      continue;
    }

    // Stopped: no tmux process, so no panes or activity.
    // last_seen_at is when we last saw it running, which is what the card
    // should show as its timestamp.
    known.push({
      name: row.name,
      path: row.working_directory,
      activity: Math.floor(new Date(`${row.last_seen_at}Z`).getTime() / 1000),
      attached: false,
      panes: 0,
      alive: false,
    });
  }

  return known;
}
