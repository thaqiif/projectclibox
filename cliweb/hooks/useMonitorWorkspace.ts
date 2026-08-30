"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  assignMonitorTerminal,
  DEFAULT_MONITOR_WORKSPACE,
  removeMonitorPane,
  type MonitorWorkspaceState,
} from "@/lib/monitor-workspace";

const RESIZE_PERSIST_MS = 250;

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
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipResizePersist = useRef(true);

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
      if (resizeTimer.current) {
        clearTimeout(resizeTimer.current);
        resizeTimer.current = null;
      }
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
          skipResizePersist.current = true;
          setWorkspace(state);
        }
      })
      .catch(() => {
        if (!cancelled) {
          loaded.current = true;
          latest.current = DEFAULT_MONITOR_WORKSPACE;
          skipResizePersist.current = true;
          setWorkspace(DEFAULT_MONITOR_WORKSPACE);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
    },
    []
  );

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
    (paneId: string, terminalId: string) => {
      const current = latest.current;
      if (current) commit(assignMonitorTerminal(current, paneId, terminalId));
    },
    [commit]
  );

  const resize = useCallback(
    (layout: Record<string, number>) => {
      const current = latest.current;
      if (!current) return;
      const panes = current.panes.map((pane) => ({
        ...pane,
        width: layout[pane.id] ?? pane.width,
      }));
      const total = panes.reduce((sum, pane) => sum + pane.width, 0);
      const next = {
        ...current,
        panes: panes.map((pane) => ({ ...pane, width: pane.width / total })),
      };
      latest.current = next;
      setWorkspace(next);

      if (skipResizePersist.current) {
        skipResizePersist.current = false;
        return;
      }
      if (!loaded.current) return;
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => {
        resizeTimer.current = null;
        persistLatest();
      }, RESIZE_PERSIST_MS);
    },
    [persistLatest]
  );

  return { workspace, toggle, addPane, removePane, assignTerminal, resize };
}
