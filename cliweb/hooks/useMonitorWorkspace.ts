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
import { TERMINAL_DRAG_TYPE } from "@/lib/drag-types";

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
  // Whether the current drag opened the workspace, and whether it landed in a
  // pane. See the drag effect below.
  const dragOpenedRef = useRef(false);
  const dragLandedRef = useRef(false);

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

  useEffect(() => {
    // Lifting a terminal card is a request to put it in a monitor pane, so the
    // workspace opens for the duration of the drag — otherwise the card is
    // lifted with nothing on screen that can receive it. A drag that ends
    // without a drop puts the workspace back the way it was, so a card nudged
    // by accident does not leave the workbench in monitor mode.
    const onDragStart = (event: DragEvent) => {
      const types = Array.from(event.dataTransfer?.types ?? []);
      if (!types.includes(TERMINAL_DRAG_TYPE)) return;

      dragLandedRef.current = false;
      const current = latest.current;
      if (!current || current.enabled) return;

      dragOpenedRef.current = true;
      commit({ ...current, enabled: true });
    };

    const onDragEnd = () => {
      const opened = dragOpenedRef.current;
      const landed = dragLandedRef.current;
      dragOpenedRef.current = false;
      dragLandedRef.current = false;
      if (!opened || landed) return;

      const current = latest.current;
      if (current?.enabled) commit({ ...current, enabled: false });
    };

    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, [commit]);

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
      if (!current) return;
      dragLandedRef.current = true;
      commit(dropMonitorTerminal(current, paneId, terminalId, side));
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
