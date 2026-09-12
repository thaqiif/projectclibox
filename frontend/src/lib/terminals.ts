import type { Session } from "../protocol";

/** Client-facing terminal shape retained for the reference sidebar and cards. */
export interface TerminalRecord {
  id: string;
  name: string;
  working_directory: string;
  project_id: string | null;
  command: string[];
  panes: number;
  attached: boolean;
  activity: number;
  alive: boolean;
  status: Session["status"];
  child_pid: number | null;
  process_group: number | null;
  rows: number;
  cols: number;
  attached_viewers: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  last_activity_at: string;
  last_attached_at: string | null;
  runtime_ms: number;
  exit_code: number | null;
  exit_signal: number | null;
  output_bytes: number;
  scrollback_bytes: number;
  scrollback_truncated: boolean;
  cpu_percent: number | null;
  memory_bytes: number | null;
  process_count: number | null;
}

export function toTerminalRecord(session: Session): TerminalRecord {
  const activity = Date.parse(session.last_activity_at);
  return {
    ...session,
    panes: 1,
    attached: session.attached_viewers > 0,
    activity: Number.isFinite(activity) ? Math.floor(activity / 1000) : 0,
    alive: !["exited", "failed"].includes(session.status),
  };
}

export function terminalToSession(terminal: TerminalRecord): Session {
  const {
    panes: _panes,
    attached: _attached,
    activity: _activity,
    alive: _alive,
    ...session
  } = terminal;
  return session;
}
