/**
 * Client-side registry for preserving terminal state across mounts.
 * Stores the scroll position the pane hands back when a terminal unmounts.
 */

interface TerminalState {
  scrollTop: number;
  scrollHeight: number;
  lastActivity: number;
  cursorY: number;
}

interface TerminalEntry {
  tabId: string;
  terminalState?: TerminalState;
}

class TerminalStateRegistry {
  private entries: Map<string, TerminalEntry> = new Map();

  /** Generate a unique key for a pane+tab combination. */
  private getKey(paneId: string, tabId: string): string {
    return `${paneId}:${tabId}`;
  }

  /** Save terminal state (scroll position, cursor, etc.). */
  saveTerminalState(paneId: string, tabId: string, state: TerminalState): void {
    const key = this.getKey(paneId, tabId);
    const existing = this.entries.get(key);

    this.entries.set(key, {
      tabId,
      ...existing,
      terminalState: state,
    });
  }

  /** Get saved terminal state. */
  getTerminalState(paneId: string, tabId: string): TerminalState | undefined {
    return this.entries.get(this.getKey(paneId, tabId))?.terminalState;
  }
}

// Singleton instance
export const terminalStateRegistry = new TerminalStateRegistry();
