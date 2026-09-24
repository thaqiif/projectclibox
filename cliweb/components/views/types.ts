import type { TerminalRecord } from "@/lib/terminals";
import type { Project } from "@/lib/db";
import type { useMonitorWorkspace } from "@/hooks/useMonitorWorkspace";

export interface ViewProps {
  terminals: TerminalRecord[];
  projects: Project[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  activeTerminal: TerminalRecord | undefined;
  monitor: ReturnType<typeof useMonitorWorkspace>;
  // Handlers
  attachToTerminal: (name: string) => void;
  /** Open a new terminal, optionally in a project's working directory. */
  handleNewTerminal: (
    projectId?: string,
    monitorPaneId?: string
  ) => Promise<void>;
  handleCloseTerminal: (name: string) => Promise<void>;
  fetchTerminals: () => Promise<void>;
  /** Detach the workbench from the attached terminal, leaving it running. */
  handleDetachTerminal: () => void;

  // Pane
  renderPane: () => React.ReactNode;
}
