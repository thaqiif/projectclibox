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

export interface ProjectDevServer {
  id: string;
  project_id: string;
  name: string;
  type: DevServerType;
  command: string;
  port: number | null;
  port_env_var: string | null;
  sort_order: number;
}

export interface ProjectRepository {
  id: string;
  project_id: string;
  name: string;
  path: string;
  is_primary: boolean;
  sort_order: number;
}



export type DevServerType = "node" | "docker";
export type DevServerStatus = "stopped" | "starting" | "running" | "failed";

export interface DevServer {
  id: string;
  project_id: string;
  type: DevServerType;
  name: string;
  command: string;
  status: DevServerStatus;
  pid: number | null;
  container_id: string | null;
  ports: string; // JSON array of port numbers
  working_directory: string;
  created_at: string;
  updated_at: string;
}
