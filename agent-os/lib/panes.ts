/**
 * Workbench state.
 *
 * There used to be a split tree and a tab list in here, both living only in
 * one browser tab's memory. Splitting is tmux's job now — `tmux split-window`
 * writes into the terminal's own window layout, so it survives a refresh, a
 * second browser, and the server restarting — and tabs are gone entirely.
 * What is left is the small amount of state the UI genuinely owns: which
 * tmux terminal the single terminal is attached to, and which view is on top.
 */

export type ViewMode = "terminal" | "files" | "git";

export interface WorkbenchState {
  /** tmux name the terminal is attached to, if any. */
  attachedTmux: string | null;
  viewMode: ViewMode;
  gitDrawerOpen: boolean;
  shellDrawerOpen: boolean;
}

/**
 * The single terminal's identity. Terminal scroll state is cached per pane
 * id, and there is now exactly one pane, so the id can be a constant.
 */
export const PANE_ID = "main";

const STORAGE_KEY = "agentos.workbench";

export function createInitialWorkbenchState(): WorkbenchState {
  return {
    attachedTmux: null,
    viewMode: "terminal",
    gitDrawerOpen: true,
    shellDrawerOpen: false,
  };
}

export function saveWorkbenchState(state: WorkbenchState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode, or storage is full. The workbench works without it.
  }
}

export function loadWorkbenchState(): WorkbenchState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<WorkbenchState>;
    const base = createInitialWorkbenchState();

    return {
      attachedTmux:
        typeof parsed.attachedTmux === "string" ? parsed.attachedTmux : null,
      viewMode:
        parsed.viewMode === "files" || parsed.viewMode === "git"
          ? parsed.viewMode
          : "terminal",
      gitDrawerOpen:
        typeof parsed.gitDrawerOpen === "boolean"
          ? parsed.gitDrawerOpen
          : base.gitDrawerOpen,
      shellDrawerOpen:
        typeof parsed.shellDrawerOpen === "boolean"
          ? parsed.shellDrawerOpen
          : base.shellDrawerOpen,
    };
  } catch {
    return null;
  }
}
