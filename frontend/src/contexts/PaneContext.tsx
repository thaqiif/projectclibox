"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  type WorkbenchState,
  type ViewMode,
  createInitialWorkbenchState,
  saveWorkbenchState,
  loadWorkbenchState,
  PANE_ID,
} from "@/lib/panes";

interface PaneContextValue {
  paneId: string;
  attachedSessionId: string | null;
  viewMode: ViewMode;
  shellDrawerOpen: boolean;
  attach: (sessionId: string) => void;
  /** Stop pointing at a terminal. The terminal itself keeps running. */
  detach: () => void;
  setViewMode: (mode: ViewMode) => void;
  toggleShellDrawer: () => void;
  /** Kept for the canonical split controls; direct PTYs do not multiplex panes. */
  splitPane: (direction: "horizontal" | "vertical") => void;
}

const PaneContext = createContext<PaneContextValue | null>(null);

export function PaneProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkbenchState>(
    createInitialWorkbenchState
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadWorkbenchState();
    const frame = requestAnimationFrame(() => {
      if (saved) setState(saved);
      setHydrated(true);
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (hydrated) saveWorkbenchState(state);
  }, [state, hydrated]);

  const attach = useCallback((sessionId: string) => {
    setState((prev) => ({ ...prev, attachedSessionId: sessionId }));
  }, []);

  const detach = useCallback(() => {
    // Back to the terminal view as well: files have no working
    // directory to point at once nothing is attached.
    setState((prev) => ({ ...prev, attachedSessionId: null, viewMode: "terminal" }));
  }, []);

  const setViewMode = useCallback((viewMode: ViewMode) => {
    setState((prev) => ({ ...prev, viewMode }));
  }, []);

  const toggleShellDrawer = useCallback(() => {
    setState((prev) => ({ ...prev, shellDrawerOpen: !prev.shellDrawerOpen }));
  }, []);

  // A direct PTY is intentionally one process stream. Keep this callback so
  // the canonical workbench controls remain in the same place, but do not
  // send a second lifecycle request.
  const splitPane = useCallback((_direction: "horizontal" | "vertical") => {}, []);

  return (
    <PaneContext.Provider
      value={{
        paneId: PANE_ID,
        attachedSessionId: state.attachedSessionId,
        viewMode: state.viewMode,
        shellDrawerOpen: state.shellDrawerOpen,
        attach,
        detach,
        setViewMode,
        toggleShellDrawer,
        splitPane,
      }}
    >
      {children}
    </PaneContext.Provider>
  );
}

export function usePanes() {
  const context = useContext(PaneContext);
  if (!context) {
    throw new Error("usePanes must be used within a PaneProvider");
  }
  return context;
}
