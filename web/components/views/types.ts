import type { TerminalRecord } from "@/lib/terminals";
import type { Project } from "@/lib/db";
import type { useMonitorWorkspace } from "@/hooks/useMonitorWorkspace";

export interface ViewProps {
  terminals: TerminalRecord[];
  projects: Project[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  monitor: ReturnType<typeof useMonitorWorkspace>;
  // Handlers
  /** Open a new terminal, optionally in a project's working directory. */
  handleNewTerminal: (
    projectId?: string,
    monitorPaneId?: string
  ) => Promise<void>;
  handleCloseTerminal: (name: string) => Promise<void>;
  fetchTerminals: () => Promise<void>;
}
