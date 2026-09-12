/**
 * Workbench state.
 *
 * The canonical workbench has one terminal surface and one file surface.
 * What is left is the small amount of state the UI genuinely owns: which
 * backend session the terminal is attached to, and which view is on top.
 */

export type ViewMode = "terminal" | "files";

export interface WorkbenchState {
  /** Backend session id the terminal is attached to, if any. */
  attachedSessionId: string | null;
  viewMode: ViewMode;
  shellDrawerOpen: boolean;
}

/**
 * The single terminal's identity. Terminal scroll state is cached per pane
 * id, and there is now exactly one pane, so the id can be a constant.
 */
export const PANE_ID = "main";

const STORAGE_KEY = "cliweb.workbench";

export function createInitialWorkbenchState(): WorkbenchState {
  return {
    attachedSessionId: null,
    viewMode: "terminal",
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
      attachedSessionId:
        typeof (parsed as Partial<WorkbenchState> & { attachedSessionId?: unknown }).attachedSessionId === "string"
          ? (parsed as Partial<WorkbenchState> & { attachedSessionId: string }).attachedSessionId
          : typeof (parsed as Partial<WorkbenchState> & { attachedTmux?: unknown }).attachedTmux === "string"
            ? (parsed as Partial<WorkbenchState> & { attachedTmux: string }).attachedTmux
            : null,
      viewMode: parsed.viewMode === "files" ? parsed.viewMode : "terminal",
      shellDrawerOpen:
        typeof parsed.shellDrawerOpen === "boolean"
          ? parsed.shellDrawerOpen
          : base.shellDrawerOpen,
    };
  } catch {
    return null;
  }
}
