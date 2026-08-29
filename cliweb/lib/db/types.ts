export interface TerminalRow {
  name: string;
  working_directory: string;
  created_at: string;
  last_seen_at: string;
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
