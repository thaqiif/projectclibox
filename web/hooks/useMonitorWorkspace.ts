"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { terminalKeys } from "@/data/terminals";
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

// Identifies this tab's saves, so the live update echoed back is skipped.
const CLIENT_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function useMonitorWorkspace() {
  const queryClient = useQueryClient();
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
          headers: {
            "Content-Type": "application/json",
            "X-Clibox-Client": CLIENT_ID,
          },
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

  // A layout saved by another device replaces the local one. The terminal
  // list is refreshed with it, since the new layout may show terminals this
  // tab has not seen yet.
  const applyRemote = useCallback(
    (state: MonitorWorkspaceState) => {
      latest.current = state;
      setWorkspace(state);
      void queryClient.invalidateQueries({ queryKey: terminalKeys.all });
    },
    [queryClient]
  );

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = RECONNECT_MIN_MS;

    const load = () =>
      fetch("/api/monitor-workspace")
        .then((response) => {
          if (!response.ok) throw new Error("Failed to load monitor workspace");
          return response.json() as Promise<MonitorWorkspaceState>;
        })
        .then((state) => {
          if (cancelled) return;
          if (loaded.current) applyRemote(state);
          else {
            loaded.current = true;
            latest.current = state;
            setWorkspace(state);
          }
        })
        .catch(() => {
          if (!cancelled && !loaded.current) {
            loaded.current = true;
            latest.current = DEFAULT_MONITOR_WORKSPACE;
            setWorkspace(DEFAULT_MONITOR_WORKSPACE);
          }
        });

    const connect = () => {
      if (cancelled) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/monitor-workspace`
      );
      socket = ws;
      ws.onopen = () => {
        reconnectDelay = RECONNECT_MIN_MS;
        // Catch up on anything saved while this tab was disconnected.
        if (loaded.current) void load();
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg?.type === "workspace" && msg.origin !== CLIENT_ID) {
            applyRemote(msg.workspace as MonitorWorkspaceState);
          }
        } catch {
          // Ignore malformed frames.
        }
      };
      ws.onclose = () => {
        if (socket !== ws) return;
        socket = null;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    };

    // Mobile browsers drop sockets in the background; reconnect right away
    // when the app comes back instead of waiting out the backoff.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (socket && socket.readyState <= WebSocket.OPEN) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      reconnectDelay = RECONNECT_MIN_MS;
      connect();
    };

    void load();
    connect();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = socket;
      socket = null;
      ws?.close();
    };
  }, [applyRemote]);

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
