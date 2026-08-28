import type { TerminalRecord } from "@/lib/terminals";
import type { ProjectWithDevServers } from "@/lib/projects";

export interface ViewProps {
  terminals: TerminalRecord[];
  projects: ProjectWithDevServers[];
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

  // Dev server (for StartServerDialog)
  handleStartDevServer: (projectId: string) => void;
  handleCreateDevServer: (opts: {
    projectId: string;
    type: "node" | "docker";
    name: string;
    command: string;
    workingDirectory: string;
    ports?: number[];
  }) => Promise<void>;
  startDevServerProject: ProjectWithDevServers | null;
  setStartDevServerProjectId: (id: string | null) => void;

  // Pane
  renderPane: () => React.ReactNode;
}
