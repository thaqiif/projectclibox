import type { TerminalRecord } from "@/lib/terminals";
import type { Project } from "@/lib/db";

export interface ViewProps {
  terminals: TerminalRecord[];
  projects: Project[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  activeTerminal: TerminalRecord | undefined;
  // Handlers
  attachToTerminal: (sessionId: string) => void;
  /** Open a new terminal, optionally in a project's working directory. */
  handleNewTerminal: (projectId?: string) => Promise<void>;
  handleCloseTerminal: (sessionId: string) => Promise<void>;
  fetchTerminals: () => Promise<void>;
  /** Detach the workbench from the attached terminal, leaving it running. */
  handleDetachTerminal: () => void;

  // Pane
  renderPane: () => React.ReactNode;
}
