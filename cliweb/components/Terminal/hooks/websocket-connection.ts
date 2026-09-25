"use client";

import type { WTerm } from "@wterm/dom";
import type { HostResourceRequest } from "@wterm/ghostty";
import type { HistoryPage } from "./history-view";
import type { NativePane, NativePaneKind } from "./native-panes";

const HISTORY_TIMEOUT_MS = 3000;
import { isValidTerminalGrid } from "../../../lib/terminal-grid";
import {
  decodeTerminalOutputFrame,
  decodeTerminalResourceFrame,
  encodeTerminalResourceFrame,
  isTerminalOutputFrame,
  TERMINAL_RESOURCE_PROTOCOL_VERSION,
} from "../../../lib/terminal-resource-protocol";
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
  onResourceFrame: (header: Record<string, unknown>, bytes: Uint8Array) => void;
  onNativeScroll?: (panes: NativePane[]) => void;
}

interface WebSocketManager {
  sendInput: (data: string) => void;
  sendCommand: (command: string) => void;
  sendNativeScroll: (pane: NativePaneKind, delta: number) => void;
  /** The shell's scrollback, or null when unavailable (see tmux-history). */
  requestHistory: (count: number) => Promise<HistoryPage | null>;
  sendResize: (cols: number, rows: number) => void;
  requestResource: (request: HostResourceRequest) => boolean;
  cancelResource: (id: number) => boolean;
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
  reconnectTimeoutRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>,
  reconnectDelayRef: React.MutableRefObject<number>,
  intentionalCloseRef: React.MutableRefObject<boolean>
): WebSocketManager {
  let disposed = false;
  let generation = 0;
  let capabilityRequest: AbortController | null = null;
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

  let historyRequestId = 0;
  const historyWaiters = new Map<number, (page: HistoryPage | null) => void>();
  const settleHistory = (id: number, page: HistoryPage | null) => {
    const resolve = historyWaiters.get(id);
    historyWaiters.delete(id);
    resolve?.(page);
  };
  const requestHistory = (count: number) =>
    new Promise<HistoryPage | null>((resolve) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        resolve(null);
        return;
      }
      const id = (historyRequestId += 1);
      historyWaiters.set(id, resolve);
      wsRef.current.send(JSON.stringify({ type: "history", id, count }));
      setTimeout(() => settleHistory(id, null), HISTORY_TIMEOUT_MS);
    });

  const sendNativeScroll = (pane: NativePaneKind, delta: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: "native_scroll", pane, delta })
      );
    }
  };

  const sendCommand = (command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", data: command }));
    }
  };

  const sendResourceFrame = (
    header: Record<string, unknown>,
    bytes?: Uint8Array
  ): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(encodeTerminalResourceFrame(header, bytes));
      return true;
    } catch {
      return false;
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
    if (
      old.readyState === WebSocket.OPEN ||
      old.readyState === WebSocket.CONNECTING
    ) {
      try {
        old.close(1000, "Replacing terminal connection");
      } catch {
        // The browser may already have discarded this socket.
      }
    }
  };

  const scheduleReconnect = () => {
    if (disposed || intentionalCloseRef.current || reconnectTimeoutRef.current)
      return;
    const delay = Math.round(
      reconnectDelayRef.current * (0.75 + Math.random() * 0.5)
    );
    reconnectDelayRef.current = Math.min(
      reconnectDelayRef.current * 2,
      WS_RECONNECT_MAX_DELAY
    );
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connect(true);
    }, delay);
  };

  const connect = async (reconnecting: boolean) => {
    if (disposed || intentionalCloseRef.current) return;
    const thisGeneration = ++generation;
    closeCurrent();
    callbacks.onConnectionStateChange(
      reconnecting ? "reconnecting" : "connecting"
    );
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

    if (
      disposed ||
      thisGeneration !== generation ||
      intentionalCloseRef.current
    )
      return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/terminal`
    );
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (thisGeneration !== generation || wsRef.current !== ws) return;
      const hello = {
        type: "hello",
        outputFormat: "binary-v1",
        token,
        cols: terminal.cols,
        rows: terminal.rows,
      };
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
      if (typeof event.data !== "string") {
        try {
          if (isTerminalOutputFrame(event.data as ArrayBuffer)) {
            callbacks.onOutput(
              decodeTerminalOutputFrame(event.data as ArrayBuffer)
            );
            return;
          }
          const frame = decodeTerminalResourceFrame(event.data as ArrayBuffer);
          callbacks.onResourceFrame(frame.header, frame.bytes);
        } catch {
          ws.close(1002, "Invalid terminal resource frame");
        }
        return;
      }
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
      } else if (
        message.type === "output" &&
        typeof message.data === "string"
      ) {
        callbacks.onOutput(message.data);
      } else if (message.type === "history") {
        const page = message as unknown as {
          id?: unknown;
          available?: unknown;
          lines?: unknown;
          height?: unknown;
          historySize?: unknown;
        };
        if (typeof page.id !== "number") return;
        settleHistory(
          page.id,
          page.available === true &&
            Array.isArray(page.lines) &&
            page.lines.every((line) => typeof line === "string") &&
            typeof page.height === "number" &&
            typeof page.historySize === "number"
            ? {
                lines: page.lines as string[],
                height: page.height,
                historySize: page.historySize,
              }
            : null
        );
      } else if (
        message.type === "native_scroll" &&
        Array.isArray((message as { panes?: unknown }).panes)
      ) {
        callbacks.onNativeScroll?.(
          (message as unknown as { panes: NativePane[] }).panes
        );
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
      for (const id of [...historyWaiters.keys()]) settleHistory(id, null);
      callbacks.onNativeScroll?.([]);
      callbacks.onDisconnected?.();
      if (
        disposed ||
        intentionalCloseRef.current ||
        thisGeneration !== generation
      ) {
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
    if (intentionalCloseRef.current || fatalError) return;
    if (document.visibilityState !== "visible") return;
    const ws = wsRef.current;
    if (
      ws?.readyState === WebSocket.CLOSED ||
      ws?.readyState === WebSocket.CLOSING ||
      (!ws && !capabilityRequest)
    ) {
      forceReconnect();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  void connect(false);

  return {
    sendInput,
    sendCommand,
    sendNativeScroll,
    requestHistory,
    sendResize,
    requestResource: (request) =>
      sendResourceFrame({
        version: TERMINAL_RESOURCE_PROTOCOL_VERSION,
        type: "request",
        id: request.id,
        transport: request.transport,
        source: request.source,
        offset: request.offset,
        length: request.length,
        width: request.width,
        height: request.height,
        format: request.format,
      }),
    cancelResource: (id) =>
      sendResourceFrame({
        version: TERMINAL_RESOURCE_PROTOCOL_VERSION,
        type: "cancel",
        id,
      }),
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
