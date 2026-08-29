import type { TerminalRecord } from "@/lib/terminals";
import type { Project } from "@/lib/db";

export interface ViewProps {
  terminals: TerminalRecord[];
  projects: Project[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  activeTerminal: TerminalRecord | undefined;
  copiedTerminalId: boolean;
  setCopiedTerminalId: (copied: boolean) => void;

  showQuickSwitcher: boolean;
  setShowQuickSwitcher: (show: boolean) => void;

  // Handlers
  attachToTerminal: (name: string) => void;
  /** Open a new terminal, optionally in a project's working directory. */
  handleNewTerminal: (projectId?: string) => Promise<void>;
  handleCloseTerminal: (name: string) => Promise<void>;
  /** Detach the workbench from the attached terminal, leaving it running. */
  handleDetachTerminal: () => void;
  handleCreateProject: (
    name: string,
    workingDirectory: string
  ) => Promise<string | null>;

  // Pane
  renderPane: () => React.ReactNode;
}
