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
import { useViewport } from "@/hooks/useViewport";

interface PaneContextValue {
  paneId: string;
  attachedTmux: string | null;
  viewMode: ViewMode;
  gitDrawerOpen: boolean;
  shellDrawerOpen: boolean;
  isMobile: boolean;
  /** True once localStorage has been read, so we do not flash the default. */
  hydrated: boolean;
  attach: (tmuxName: string) => void;
  /** Stop pointing at a terminal. The terminal itself keeps running. */
  detach: () => void;
  setViewMode: (mode: ViewMode) => void;
  toggleGitDrawer: () => void;
  toggleShellDrawer: () => void;
  /** Ask tmux to split the attached terminal's active pane. */
  splitPane: (direction: "horizontal" | "vertical") => void;
}

const PaneContext = createContext<PaneContextValue | null>(null);

export function PaneProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkbenchState>(
    createInitialWorkbenchState
  );
  const [hydrated, setHydrated] = useState(false);
  const { isMobile } = useViewport();

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
    // Back to the terminal view as well: files and git have no working
    // directory to point at once nothing is attached.
    setState((prev) => ({ ...prev, attachedTmux: null, viewMode: "terminal" }));
  }, []);

  const setViewMode = useCallback((viewMode: ViewMode) => {
    setState((prev) => ({ ...prev, viewMode }));
  }, []);

  const toggleGitDrawer = useCallback(() => {
    setState((prev) => ({ ...prev, gitDrawerOpen: !prev.gitDrawerOpen }));
  }, []);

  const toggleShellDrawer = useCallback(() => {
    setState((prev) => ({ ...prev, shellDrawerOpen: !prev.shellDrawerOpen }));
  }, []);

  // Fire-and-forget: tmux redraws the attached client itself, so there is
  // nothing to update on this side. The terminal is showing tmux's output,
  // and the new pane simply appears in it.
  const splitPane = useCallback(
    (direction: "horizontal" | "vertical") => {
      if (!state.attachedTmux) return;
      fetch("/api/tmux/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal: state.attachedTmux, direction }),
      }).catch((err) => console.error("Failed to split tmux pane:", err));
    },
    [state.attachedTmux]
  );

  return (
    <PaneContext.Provider
      value={{
        paneId: PANE_ID,
        attachedTmux: state.attachedTmux,
        viewMode: state.viewMode,
        gitDrawerOpen: state.gitDrawerOpen,
        shellDrawerOpen: state.shellDrawerOpen,
        isMobile,
        hydrated,
        attach,
        detach,
        setViewMode,
        toggleGitDrawer,
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
