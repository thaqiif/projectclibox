"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_MONITOR_WORKSPACE,
  dropMonitorTerminal,
  moveMonitorPane,
  removeMonitorPane,
  type MonitorDropSide,
  type MonitorWorkspaceState,
} from "@/lib/monitor-workspace";

export function useMonitorWorkspace() {
  const [workspace, setWorkspace] = useState<MonitorWorkspaceState | null>(
    null
  );
  const loaded = useRef(false);
  // The newest workspace, read when a write is sent rather than when it is
  // queued, so the last request always carries the state the user has.
  const latest = useRef<MonitorWorkspaceState | null>(null);
  // PUTs are chained: each one waits for the previous to settle, so they can
  // never arrive out of order and leave the server holding an older layout.
  const pendingWrite = useRef<Promise<void>>(Promise.resolve());

  const persistLatest = useCallback(() => {
    if (!loaded.current) return;
    pendingWrite.current = pendingWrite.current
      .then(async () => {
        if (!latest.current) return;
        await fetch("/api/monitor-workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(latest.current),
        });
      })
      .catch(() => {
        // Persistence is best effort: the workspace the user is looking at is
        // already in local state, and the next write persists it again.
      });
  }, []);

  const commit = useCallback(
    (next: MonitorWorkspaceState) => {
      latest.current = next;
      setWorkspace(next);
      persistLatest();
    },
    [persistLatest]
  );

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/monitor-workspace")
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load monitor workspace");
        return response.json() as Promise<MonitorWorkspaceState>;
      })
      .then((state) => {
        if (!cancelled) {
          loaded.current = true;
          latest.current = state;
          setWorkspace(state);
        }
      })
      .catch(() => {
        if (!cancelled) {
          loaded.current = true;
          latest.current = DEFAULT_MONITOR_WORKSPACE;
          setWorkspace(DEFAULT_MONITOR_WORKSPACE);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(() => {
    const current = latest.current;
    if (current) commit({ ...current, enabled: !current.enabled });
  }, [commit]);

  const addPane = useCallback(() => {
    const current = latest.current;
    if (!current || current.panes.length >= 3) return;
    const count = current.panes.length + 1;
    commit({
      ...current,
      panes: [
        ...current.panes.map((pane) => ({ ...pane, width: 1 / count })),
        { id: `monitor-${Date.now()}`, terminalId: null, width: 1 / count },
      ],
    });
  }, [commit]);

  const removePane = useCallback(
    (paneId: string) => {
      const current = latest.current;
      if (current) commit(removeMonitorPane(current, paneId));
    },
    [commit]
  );

  const assignTerminal = useCallback(
    (paneId: string, terminalId: string, side: MonitorDropSide = "center") => {
      const current = latest.current;
      if (current) commit(dropMonitorTerminal(current, paneId, terminalId, side));
    },
    [commit]
  );

  const movePane = useCallback(
    (sourcePaneId: string, anchorPaneId: string, side: MonitorDropSide) => {
      const current = latest.current;
      if (current) commit(moveMonitorPane(current, sourcePaneId, anchorPaneId, side));
    },
    [commit]
  );

  return { workspace, toggle, addPane, removePane, assignTerminal, movePane };
}
