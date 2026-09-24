"use client";

import type { WTerm } from "@wterm/dom";
import { isValidTerminalGrid } from "../../../lib/terminal-grid";
import { WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from "../constants";

type ConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

interface WebSocketCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onFatalError: (message: string) => void;
  onOutput: (data: string) => void;
}

interface WebSocketManager {
  sendInput: (data: string) => void;
  sendCommand: (command: string) => void;
  sendResize: (cols: number, rows: number) => void;
  reconnect: () => void;
  cleanup: () => void;
}

interface ServerMessage {
  type?: unknown;
  data?: unknown;
  code?: unknown;
  message?: unknown;
}

export function createWebSocketConnection(
  terminal: WTerm,
  sessionName: string,
  callbacks: WebSocketCallbacks,
  wsRef: React.MutableRefObject<WebSocket | null>,
  reconnectTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  reconnectDelayRef: React.MutableRefObject<number>,
  intentionalCloseRef: React.MutableRefObject<boolean>
): WebSocketManager {
  let disposed = false;
  let generation = 0;
  let capabilityRequest: AbortController | null = null;
  let hiddenAt: number | null = null;
  let fatalError = false;

  const sendResize = (cols: number, rows: number) => {
    if (!isValidTerminalGrid({ cols, rows })) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  };

  const sendInput = (data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data }));
    }
  };

  const sendCommand = (command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", data: command }));
    }
  };

  const closeCurrent = () => {
    capabilityRequest?.abort();
    capabilityRequest = null;
    const old = wsRef.current;
    wsRef.current = null;
    if (!old) return;
    old.onopen = null;
    old.onmessage = null;
    old.onclose = null;
    old.onerror = null;
    if (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING) {
      try {
        old.close(1000, "Replacing terminal connection");
      } catch {
        // The browser may already have discarded this socket.
      }
    }
  };

  const scheduleReconnect = () => {
    if (disposed || intentionalCloseRef.current || reconnectTimeoutRef.current) return;
    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(delay * 2, WS_RECONNECT_MAX_DELAY);
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connect(true);
    }, delay);
  };

  const connect = async (reconnecting: boolean) => {
    if (disposed || intentionalCloseRef.current) return;
    const thisGeneration = ++generation;
    closeCurrent();
    callbacks.onConnectionStateChange(reconnecting ? "reconnecting" : "connecting");
    const controller = new AbortController();
    capabilityRequest = controller;

    let token: string;
    try {
      const response = await fetch("/api/terminal-capability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({ sessionName }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        token?: unknown;
        error?: unknown;
      };
      if (!response.ok || typeof result.token !== "string") {
        const message =
          typeof result.error === "string"
            ? result.error
            : "Could not authorize terminal session";
        if (response.status >= 400 && response.status < 500) {
          callbacks.onConnectionStateChange("error");
          fatalError = true;
          callbacks.onFatalError(message);
          return;
        }
        throw new Error(message);
      }
      token = result.token;
    } catch (error) {
      if (controller.signal.aborted || thisGeneration !== generation) return;
      if (error instanceof Error && error.name !== "AbortError") {
        console.error("Terminal capability request failed:", error);
      }
      callbacks.onConnectionStateChange("disconnected");
      scheduleReconnect();
      return;
    } finally {
      if (capabilityRequest === controller) capabilityRequest = null;
    }

    if (disposed || thisGeneration !== generation || intentionalCloseRef.current) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (thisGeneration !== generation || wsRef.current !== ws) return;
      const hello = { type: "hello", token, cols: terminal.cols, rows: terminal.rows };
      if (!isValidTerminalGrid(hello)) {
        callbacks.onConnectionStateChange("error");
        fatalError = true;
        callbacks.onFatalError("Terminal reported invalid dimensions");
        ws.close(1008, "Invalid terminal dimensions");
        return;
      }
      ws.send(JSON.stringify(hello));
    };

    ws.onmessage = (event) => {
      if (thisGeneration !== generation || wsRef.current !== ws) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        terminal.write(String(event.data));
        return;
      }

      if (message.type === "ready") {
        callbacks.onConnectionStateChange("connected");
        reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
        callbacks.onConnected?.();
        sendResize(terminal.cols, terminal.rows);
      } else if (message.type === "output" && typeof message.data === "string") {
        callbacks.onOutput(message.data);
      } else if (message.type === "exit") {
        terminal.write("\r\n\x1b[33m[Terminal ended]\x1b[0m\r\n");
      } else if (message.type === "error") {
        const messageText =
          typeof message.message === "string"
            ? message.message
            : "Terminal connection was rejected";
        callbacks.onConnectionStateChange("error");
        fatalError = true;
        callbacks.onFatalError(messageText);
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      callbacks.onDisconnected?.();
      if (disposed || intentionalCloseRef.current || thisGeneration !== generation) {
        callbacks.onConnectionStateChange("disconnected");
        return;
      }
      if (fatalError) {
        callbacks.onConnectionStateChange("error");
        return;
      }
      if (ws.readyState === WebSocket.CLOSED) {
        callbacks.onConnectionStateChange("disconnected");
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // The close event contains the reconnect decision.
    };
  };

  const forceReconnect = () => {
    if (disposed || intentionalCloseRef.current) return;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    callbacks.onConnectionStateChange("reconnecting");
    reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
    fatalError = false;
    void connect(true);
  };

  const handleVisibilityChange = () => {
    if (intentionalCloseRef.current) return;
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    if (document.visibilityState !== "visible") return;

    const hiddenDuration = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    const ws = wsRef.current;
    if (
      hiddenDuration > 5_000 ||
      !ws ||
      ws.readyState === WebSocket.CLOSED ||
      ws.readyState === WebSocket.CLOSING ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      forceReconnect();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  void connect(false);

  return {
    sendInput,
    sendCommand,
    sendResize,
    reconnect: forceReconnect,
    cleanup: () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      closeCurrent();
    },
  };
}
