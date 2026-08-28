import type { TerminalRecord } from "@/lib/terminals";

export interface TerminalListProps {
  /** tmux name of the terminal currently attached. */
  activeTerminalId?: string;
  onSelect: (name: string) => void;
  /** Open a new terminal, optionally in a project's working directory. */
  onNewTerminal?: (projectId?: string) => void;
  onCloseTerminal?: (name: string) => void;
  onStartDevServer?: (projectId: string) => void;
  onCreateDevServer?: (opts: {
    projectId: string;
    type: "node" | "docker";
    name: string;
    command: string;
    workingDirectory: string;
    ports?: number[];
  }) => Promise<void>;
  onQuickSwitch?: () => void;
}

export interface TerminalHoverHandlers {
  onHoverStart: (terminal: TerminalRecord, rect: DOMRect) => void;
  onHoverEnd: () => void;
}
