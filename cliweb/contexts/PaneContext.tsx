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
  attachedTmux: string | null;
  viewMode: ViewMode;
  attach: (tmuxName: string) => void;
  /** Stop pointing at a terminal. The terminal itself keeps running. */
  detach: () => void;
  setViewMode: (mode: ViewMode) => void;
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

  const attach = useCallback((tmuxName: string) => {
    setState((prev) => ({ ...prev, attachedTmux: tmuxName }));
  }, []);

  const detach = useCallback(() => {
    // Back to the terminal view as well: files have no working
    // directory to point at once nothing is attached.
    setState((prev) => ({ ...prev, attachedTmux: null, viewMode: "terminal" }));
  }, []);

  const setViewMode = useCallback((viewMode: ViewMode) => {
    setState((prev) => ({ ...prev, viewMode }));
  }, []);

  return (
    <PaneContext.Provider
      value={{
        paneId: PANE_ID,
        attachedTmux: state.attachedTmux,
        viewMode: state.viewMode,
        attach,
        detach,
        setViewMode,
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
