"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_MONITOR_WORKSPACE,
  MAX_MONITOR_PANES,
  dropMonitorTerminal,
  moveMonitorPane,
  openMonitorTerminal,
  renameMonitorTerminal,
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

  const openTerminal = useCallback(
    (terminalId: string) => {
      const current = latest.current;
      if (current) commit(openMonitorTerminal(current, terminalId));
    },
    [commit]
  );

  const renameTerminal = useCallback(
    (from: string, to: string) => {
      const current = latest.current;
      if (current) commit(renameMonitorTerminal(current, from, to));
    },
    [commit]
  );

  const addPane = useCallback(() => {
    const current = latest.current;
    if (!current || current.panes.length >= MAX_MONITOR_PANES) return undefined;
    const count = current.panes.length + 1;
    const paneId = `monitor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    commit({
      ...current,
      panes: [
        ...current.panes.map((pane) => ({ ...pane, width: 1 / count })),
        { id: paneId, terminalId: null, width: 1 / count },
      ],
    });
    return paneId;
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
      if (!current) return;
      commit(dropMonitorTerminal(current, paneId, terminalId, side));
    },
    [commit]
  );

  const movePane = useCallback(
    (sourcePaneId: string, anchorPaneId: string, side: MonitorDropSide) => {
      const current = latest.current;
      if (current)
        commit(moveMonitorPane(current, sourcePaneId, anchorPaneId, side));
    },
    [commit]
  );

  return {
    workspace,
    openTerminal,
    renameTerminal,
    addPane,
    removePane,
    assignTerminal,
    movePane,
  };
}
