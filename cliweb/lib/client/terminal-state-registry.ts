/**
 * Client-side registry for preserving terminal state across navigation.
 * Stores scroll positions and other ephemeral state that should persist
 * when switching between terminal views.
 */

interface TerminalState {
  scrollTop: number;
  scrollHeight: number;
  lastActivity: number;
  cursorY: number;
}

interface TerminalEntry {
  tabId: string;
  terminalId?: string;
  attachedTmux?: string;
  terminalState?: TerminalState;
}

class TerminalStateRegistry {
  private entries: Map<string, TerminalEntry> = new Map();

  /** Generate a unique key for a pane+tab combination. */
  private getKey(paneId: string, tabId: string): string {
    return `${paneId}:${tabId}`;
  }

  /** Register or update a terminal entry. */
  register(
    paneId: string,
    tabId: string,
    data: Partial<Omit<TerminalEntry, "tabId">>
  ): void {
    const key = this.getKey(paneId, tabId);
    const existing = this.entries.get(key);

    this.entries.set(key, {
      tabId,
      ...existing,
      ...data,
    });
  }

  /** Get a terminal entry. */
  get(paneId: string, tabId: string): TerminalEntry | undefined {
    return this.entries.get(this.getKey(paneId, tabId));
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

  /** Remove a terminal entry. */
  remove(paneId: string, tabId: string): void {
    this.entries.delete(this.getKey(paneId, tabId));
  }

  /** Clear all entries for a pane. */
  clearPane(paneId: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${paneId}:`)) {
        this.entries.delete(key);
      }
    }
  }

  /** Clear all entries. */
  clear(): void {
    this.entries.clear();
  }

  /** Get count of active terminals. */
  get size(): number {
    return this.entries.size;
  }
}

// Singleton instance
export const terminalStateRegistry = new TerminalStateRegistry();
