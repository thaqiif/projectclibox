export type SessionStatus =
  | "starting"
  | "running"
  | "idle"
  | "disconnected"
  | "exited"
  | "failed"
  | "terminating";

export interface Session {
  id: string;
  name: string;
  project_id: string | null;
  working_directory: string;
  command: string[];
  status: SessionStatus;
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

export interface Project {
  id: string;
  name: string;
  working_directory: string;
  expanded: boolean;
  sort_order: number;
  is_uncategorized: boolean;
  created_at: string;
  updated_at: string;
}

export interface FileNode {
  name: string;
  path: string;
  relative_path: string;
  type: "directory" | "file";
  size: number | null;
  extension: string | null;
  modified_at: string | null;
}

export interface DirectoryPage {
  files: FileNode[];
  path: string;
  next_cursor: string | null;
  scanned: number;
  truncated: boolean;
}

export interface FileContent {
  content: string;
  is_binary: boolean;
  size: number;
  path: string;
}

export const OUTPUT_FRAME_VERSION = 1;
export const OUTPUT_FRAME_HEADER_BYTES = 9;

export function decodeOutputFrame(data: ArrayBuffer): { sequence: number; text: string } | null {
  if (data.byteLength < OUTPUT_FRAME_HEADER_BYTES) return null;
  const bytes = new Uint8Array(data);
  if (bytes[0] !== OUTPUT_FRAME_VERSION) return null;
  const view = new DataView(data);
  const sequenceBig = view.getBigUint64(1);
  const sequence = Number(sequenceBig);
  const text = new TextDecoder().decode(bytes.subarray(OUTPUT_FRAME_HEADER_BYTES));
  return { sequence, text };
}
