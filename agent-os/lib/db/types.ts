import type { AgentType } from "../providers";



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
  agent_type: AgentType;
  default_model: string;
  initial_prompt: string | null;
  expanded: boolean;
  sort_order: number;
  is_uncategorized: boolean;
  created_at: string;
  updated_at: string;
}
