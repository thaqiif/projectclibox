export interface TerminalListProps {
  /** tmux name of the terminal currently attached. */
  activeTerminalId?: string;
  onSelect: (name: string) => void;
  /** Open a new terminal, optionally in a project's working directory. */
  onNewTerminal?: (projectId?: string) => void;
  onCloseTerminal?: (name: string) => void;
  enableTerminalDrag?: boolean;
  onClosedAllTerminals?: () => void;
  onCloseSidebar?: () => void;
}
