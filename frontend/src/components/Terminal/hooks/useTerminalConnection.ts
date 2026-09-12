"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from "../constants";
import { decodeOutputFrame } from "@/protocol";
import { DEFAULT_FONT_SCALE } from "@/lib/font-scale";
import type {
  TerminalScrollState,
  UseTerminalConnectionProps,
  UseTerminalConnectionReturn,
} from "./useTerminalConnection.types";
import {
  createTerminal,
  updateTerminalForMobile,
  updateTerminalTheme,
} from "./terminal-init";
import { setupTouchScroll } from "./touch-scroll";
import { setupResizeHandlers } from "./resize-handlers";

export type { TerminalScrollState } from "./useTerminalConnection.types";

type ConnectionState = UseTerminalConnectionReturn["connectionState"];

const RECONNECT_JITTER = 250;

function websocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/terminal`;
}

function isOpen(socket: WebSocket | null): socket is WebSocket {
  return socket?.readyState === WebSocket.OPEN;
}

/**
 * Owns one xterm instance and one direct PTY WebSocket attachment.
 *
 * The server is the source of truth for session identity and output history.
 * Sequence numbers let a reconnect request only the bytes that were missed;
 * no shell command or secondary lifecycle is hidden in this hook.
 */
export function useTerminalConnection({
  sessionId,
  terminalRef,
  onConnected,
  onDisconnected,
  onBeforeUnmount,
  initialScrollState,
  isMobile = false,
  fontScale = DEFAULT_FONT_SCALE,
  theme = "dark",
  selectMode = false,
}: UseTerminalConnectionProps): UseTerminalConnectionReturn {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    "connecting"
  );

  const socketRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(WS_RECONNECT_BASE_DELAY);
  const reconnectFnRef = useRef<(() => void) | null>(null);
  const lastSequenceRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const permanentCloseRef = useRef(false);
  const connectedRef = useRef(false);
  const fontScaleRef = useRef(fontScale);
  const initialScrollStateRef = useRef(initialScrollState);
  const callbacksRef = useRef({ onConnected, onDisconnected, onBeforeUnmount });
  const selectModeRef = useRef(selectMode);

  useEffect(() => {
    fontScaleRef.current = fontScale;
  }, [fontScale]);

  useEffect(() => {
    callbacksRef.current = { onConnected, onDisconnected, onBeforeUnmount };
  }, [onConnected, onDisconnected, onBeforeUnmount]);

  useEffect(() => {
    initialScrollStateRef.current = initialScrollState;
  }, [initialScrollState]);

  useEffect(() => {
    selectModeRef.current = selectMode;
  }, [selectMode]);

  const scrollToBottom = useCallback(() => {
    xtermRef.current?.scrollToBottom();
  }, []);

  const copySelection = useCallback(() => {
    const selection = xtermRef.current?.getSelection();
    if (!selection) return false;
    void navigator.clipboard?.writeText(selection);
    return true;
  }, []);

  const sendInput = useCallback((data: string) => {
    const socket = socketRef.current;
    if (isOpen(socket)) {
      socket.send(JSON.stringify({ type: "terminal.input", data }));
    }
  }, []);

  const sendCommand = useCallback((command: string) => {
    const socket = socketRef.current;
    if (isOpen(socket)) {
      socket.send(JSON.stringify({ type: "terminal.input", data: command }));
    }
  }, []);

  const focus = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  const reconnect = useCallback(() => {
    reconnectFnRef.current?.();
  }, []);

  useEffect(() => {
    const element = terminalRef.current;
    if (!element || !sessionId) return;

    let cancelled = false;
    let cleanupTouchScroll: (() => void) | undefined;
    let cleanupResizeHandlers: (() => void) | undefined;
    let cleanupTerminal: (() => void) | undefined;
    let disposeInput: (() => void) | undefined;

    intentionalCloseRef.current = false;
    permanentCloseRef.current = false;
    connectedRef.current = false;
    lastSequenceRef.current = 0;
    setConnectionState("connecting");

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const sendResize = (cols: number, rows: number) => {
      const socket = socketRef.current;
      if (isOpen(socket)) {
        socket.send(
          JSON.stringify({ type: "terminal.resize", cols, rows })
        );
      }
    };

    const restoreScroll = () => {
      const scrollTop = initialScrollStateRef.current?.scrollTop;
      if (scrollTop === undefined) return;
      window.setTimeout(() => {
        const viewport = element.querySelector(
          ".xterm-viewport"
        ) as HTMLElement | null;
        if (viewport) viewport.scrollTop = scrollTop;
      }, 200);
    };

    const writeConnectionMessage = (message: string) => {
      xtermRef.current?.write(`\r\n\x1b[90m${message}\x1b[0m\r\n`);
    };

    const scheduleReconnect = () => {
      if (cancelled || intentionalCloseRef.current) return;
      clearReconnectTimer();
      const delay = Math.min(
        reconnectDelayRef.current + Math.floor(Math.random() * RECONNECT_JITTER),
        WS_RECONNECT_MAX_DELAY
      );
      reconnectDelayRef.current = Math.min(
        Math.max(WS_RECONNECT_BASE_DELAY, reconnectDelayRef.current * 2),
        WS_RECONNECT_MAX_DELAY
      );
      setConnectionState("reconnecting");
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    const handleControlMessage = (raw: string) => {
      let message: {
        type?: string;
        replayedThrough?: number;
        truncated?: boolean;
        code?: string;
        message?: string;
        lastSequence?: number;
        snapshot?: { status?: string };
      };
      try {
        message = JSON.parse(raw) as typeof message;
      } catch {
        return;
      }

      switch (message.type) {
        case "terminal.ready":
          // The server sends the ready control frame before the replayed
          // binary frames. Do not advance the cursor to replayedThrough here,
          // or the replay would be discarded as already seen.
          if (message.truncated) {
            writeConnectionMessage("output history truncated by the server");
          }
          connectedRef.current = true;
          reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
          setConnectionState("connected");
          sendResize(xtermRef.current?.cols ?? 80, xtermRef.current?.rows ?? 24);
          callbacksRef.current.onConnected?.();
          restoreScroll();
          break;
        case "terminal.state":
          if (message.snapshot?.status === "exited" || message.snapshot?.status === "failed") {
            permanentCloseRef.current = true;
            setConnectionState("disconnected");
          }
          break;
        case "terminal.exit":
          permanentCloseRef.current = true;
          setConnectionState("disconnected");
          break;
        case "terminal.gap":
          if (message.lastSequence !== undefined) {
            lastSequenceRef.current = message.lastSequence;
          }
          xtermRef.current?.clear();
          writeConnectionMessage("output gap detected; reconnecting from the latest history");
          socketRef.current?.close();
          break;
        case "terminal.error":
          permanentCloseRef.current = message.code === "attach_failed";
          writeConnectionMessage(message.message ?? "terminal connection error");
          setConnectionState("disconnected");
          socketRef.current?.close();
          break;
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        handleControlMessage(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        const frame = decodeOutputFrame(event.data);
        if (!frame || frame.sequence <= lastSequenceRef.current) return;
        lastSequenceRef.current = frame.sequence;
        xtermRef.current?.write(frame.text);
        return;
      }
      if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buffer) => {
          if (cancelled) return;
          const frame = decodeOutputFrame(buffer);
          if (!frame || frame.sequence <= lastSequenceRef.current) return;
          lastSequenceRef.current = frame.sequence;
          xtermRef.current?.write(frame.text);
        });
      }
    };

    const connect = () => {
      if (cancelled || intentionalCloseRef.current) return;
      const existing = socketRef.current;
      if (existing && existing.readyState !== WebSocket.CLOSED) return;

      setConnectionState(connectedRef.current ? "reconnecting" : "connecting");
      const socket = new WebSocket(websocketUrl());
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (cancelled || socket !== socketRef.current) return;
        socket.send(
          JSON.stringify({
            type: "terminal.attach",
            sessionId,
            fromSequence: lastSequenceRef.current,
          })
        );
      });
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("close", () => {
        if (socket !== socketRef.current) return;
        socketRef.current = null;
        if (cancelled || intentionalCloseRef.current) return;
        if (permanentCloseRef.current) {
          setConnectionState("disconnected");
          return;
        }
        if (connectedRef.current) callbacksRef.current.onDisconnected?.();
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        if (socket === socketRef.current) socket.close();
      });
    };

    reconnectFnRef.current = () => {
      permanentCloseRef.current = false;
      clearReconnectTimer();
      reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
      const socket = socketRef.current;
      if (socket) {
        socket.close();
      } else {
        connect();
      }
    };

    const setup = window.setTimeout(() => {
      if (cancelled) return;
      const instance = createTerminal(
        element,
        isMobile,
        theme,
        fontScaleRef.current
      );
      xtermRef.current = instance.term;
      fitAddonRef.current = instance.fitAddon;
      cleanupTerminal = instance.cleanup;

      // xterm owns keyboard handling, but the Rust PTY owns the input stream.
      // Forward every xterm data event to the attached WebSocket session.
      const inputDisposable = instance.term.onData((data) => {
        sendInput(data);
      });
      disposeInput = () => inputDisposable.dispose();

      instance.term.onScroll(() => {
        const buffer = instance.term.buffer.active;
        setIsAtBottom(buffer.viewportY >= buffer.baseY);
      });
      cleanupTouchScroll = setupTouchScroll({
        term: instance.term,
        selectModeRef,
      });
      cleanupResizeHandlers = setupResizeHandlers({
        term: instance.term,
        fitAddon: instance.fitAddon,
        containerRef: terminalRef,
        isMobile,
        sendResize,
      });
      connect();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(setup);
      intentionalCloseRef.current = true;
      clearReconnectTimer();
      reconnectFnRef.current = null;

      const term = xtermRef.current;
      if (term) {
        const buffer = term.buffer.active;
        const viewport = element.querySelector(
          ".xterm-viewport"
        ) as HTMLElement | null;
        callbacksRef.current.onBeforeUnmount?.({
          scrollTop: viewport?.scrollTop ?? 0,
          cursorY: buffer.cursorY,
          baseY: buffer.baseY,
        });
      }

      cleanupResizeHandlers?.();
      cleanupTouchScroll?.();
      disposeInput?.();
      cleanupTerminal?.();
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "terminal.detach" }));
      }
      socket?.close();
      socketRef.current = null;
      connectedRef.current = false;
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, terminalRef, isMobile, theme]);

  useEffect(() => {
    const term = xtermRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;
    updateTerminalForMobile(
      term,
      fitAddon,
      isMobile,
      (cols, rows) => {
        const socket = socketRef.current;
        if (isOpen(socket)) {
          socket.send(JSON.stringify({ type: "terminal.resize", cols, rows }));
        }
      },
      fontScale
    );
  }, [isMobile, fontScale]);

  useEffect(() => {
    if (xtermRef.current) updateTerminalTheme(xtermRef.current, theme);
  }, [theme]);

  return {
    connectionState,
    isAtBottom,
    xtermRef,
    scrollToBottom,
    copySelection,
    sendInput,
    sendCommand,
    focus,
    reconnect,
  };
}
