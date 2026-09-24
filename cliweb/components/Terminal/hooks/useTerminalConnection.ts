"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { WTerm } from "@wterm/dom";
import type { GhosttyCore } from "@wterm/ghostty";
import type {
  TerminalConnectionState,
  TerminalScrollState,
  UseTerminalConnectionProps,
  UseTerminalConnectionReturn,
} from "./useTerminalConnection.types";
import {
  createTerminalEngineAdapter,
  restoreTerminalScroll,
  setTerminalScrollBottom,
} from "./terminal-engine-adapter";
import { setupTouchScroll } from "./touch-scroll";
import { createWebSocketConnection } from "./websocket-connection";
import { DEFAULT_FONT_SCALE } from "../../../lib/font-scale";
import { Osc52Filter } from "../../../lib/osc52-filter";
import { WS_RECONNECT_BASE_DELAY } from "../constants";

export type { TerminalScrollState } from "./useTerminalConnection.types";

export function useTerminalConnection({
  terminalRef,
  sessionName,
  isActive = true,
  onConnected,
  onDisconnected,
  onBeforeUnmount,
  onClipboardWrite,
  onTitle,
  initialScrollState,
  isMobile = false,
  fontScale = DEFAULT_FONT_SCALE,
  theme = "dark",
  selectMode = false,
}: UseTerminalConnectionProps): UseTerminalConnectionReturn {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [connectionState, setConnectionState] =
    useState<TerminalConnectionState>("connecting");
  const [initializationError, setInitializationError] = useState<string | null>(
    null
  );
  const [retryGeneration, setRetryGeneration] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const terminalInstanceRef = useRef<WTerm | null>(null);
  const coreRef = useRef<GhosttyCore | null>(null);
  const adapterRef = useRef<Awaited<ReturnType<typeof createTerminalEngineAdapter>> | null>(null);
  const managerRef = useRef<ReturnType<typeof createWebSocketConnection> | null>(
    null
  );
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef<number>(WS_RECONNECT_BASE_DELAY);
  const intentionalCloseRef = useRef<boolean>(false);
  const selectModeRef = useRef(selectMode);
  const activeRef = useRef(isActive);
  const appearanceRef = useRef({ isMobile, theme, fontScale });
  const initialScrollTopRef = useRef(initialScrollState?.scrollTop);
  const touchCleanupRef = useRef<(() => void) | null>(null);
  const callbacksRef = useRef({
    onConnected,
    onDisconnected,
    onBeforeUnmount,
    onClipboardWrite,
    onTitle,
  });
  const osc52FilterRef = useRef(new Osc52Filter());

  useEffect(() => {
    appearanceRef.current = { isMobile, theme, fontScale };
    initialScrollTopRef.current = initialScrollState?.scrollTop;
  }, [isMobile, theme, fontScale, initialScrollState?.scrollTop]);

  useEffect(() => {
    callbacksRef.current = {
      onConnected,
      onDisconnected,
      onBeforeUnmount,
      onClipboardWrite,
      onTitle,
    };
  }, [onConnected, onDisconnected, onBeforeUnmount, onClipboardWrite, onTitle]);
  useEffect(() => {
    selectModeRef.current = selectMode;
  }, [selectMode]);
  useEffect(() => {
    activeRef.current = isActive;
  }, [isActive]);

  const scrollToBottom = useCallback(() => {
    const terminal = terminalInstanceRef.current;
    if (terminal) setTerminalScrollBottom(terminal);
  }, []);

  const copySelection = useCallback(() => {
    const selection = window.getSelection()?.toString() ?? "";
    if (!selection) return false;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(selection).catch(() => undefined);
      return true;
    }
    return false;
  }, []);

  const sendInput = useCallback((data: string) => {
    managerRef.current?.sendInput(data);
  }, []);
  const sendCommand = useCallback((command: string) => {
    managerRef.current?.sendCommand(command);
  }, []);
  const focus = useCallback(() => {
    terminalInstanceRef.current?.focus();
  }, []);
  const reconnect = useCallback(() => {
    setInitializationError(null);
    const manager = managerRef.current;
    if (manager) {
      manager.reconnect();
      return;
    }
    setConnectionState("connecting");
    setRetryGeneration((generation) => generation + 1);
  }, []);

  useEffect(() => {
    const element = terminalRef.current;
    if (!element) return;
    const osc52Filter = osc52FilterRef.current;

    let cancelled = false;
    let onScroll: (() => void) | null = null;
    intentionalCloseRef.current = false;
    managerRef.current = null;
    terminalInstanceRef.current = null;
    coreRef.current = null;
    adapterRef.current = null;
    const start = async () => {
      if (!sessionName) {
        throw new Error("Select a live terminal session to connect");
      }

      const adapter = await createTerminalEngineAdapter(element, {
        isMobile: appearanceRef.current.isMobile,
        theme: appearanceRef.current.theme,
        fontScale: appearanceRef.current.fontScale,
        onData: sendInput,
        onResize: (cols, rows) => managerRef.current?.sendResize(cols, rows),
        onTitle: (title) => callbacksRef.current.onTitle?.(title),
      });
      if (cancelled) {
        adapter.dispose();
        return;
      }

      adapterRef.current = adapter;
      terminalInstanceRef.current = adapter.terminal;
      coreRef.current = adapter.core;

      onScroll = () => {
        const terminal = adapter.terminal;
        const atBottom =
          terminal.element.scrollHeight -
            terminal.element.scrollTop -
            terminal.element.clientHeight <=
          2;
        setIsAtBottom(atBottom);
      };
      adapter.terminal.element.addEventListener("scroll", onScroll, {
        passive: true,
      });
      touchCleanupRef.current = setupTouchScroll({
        terminal: adapter.terminal,
        core: adapter.core,
        selectModeRef,
        isMobile: appearanceRef.current.isMobile,
      });

      // Wait for WTerm's ResizeObserver to measure the real pane before the
      // one-use capability is issued and the PTY is attached.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      if (cancelled) return;
      adapter.fit();
      restoreTerminalScroll(adapter.terminal, initialScrollTopRef.current);

      managerRef.current = createWebSocketConnection(
        adapter.terminal,
        sessionName,
        {
          onConnected: () => {
            callbacksRef.current.onConnected?.();
            if (activeRef.current) adapter.terminal.focus();
          },
          onDisconnected: () => callbacksRef.current.onDisconnected?.(),
          onConnectionStateChange: setConnectionState,
          onFatalError: setInitializationError,
          onOutput: (data) => {
            const result = osc52Filter.push(data);
            if (result.terminalData) adapter.terminal.write(result.terminalData);
            if (result.clipboardText !== undefined) {
              callbacksRef.current.onClipboardWrite?.(result.clipboardText);
            }
          },
        },
        wsRef,
        reconnectTimeoutRef,
        reconnectDelayRef,
        intentionalCloseRef
      );
    };

    void start().catch((error: unknown) => {
      if (cancelled) return;
      const message =
        error instanceof Error ? error.message : "Terminal initialization failed";
      console.error("Failed to initialize WTerm/Ghostty:", error);
      setInitializationError(message);
      setConnectionState("error");
    });

    return () => {
      cancelled = true;
      intentionalCloseRef.current = true;
      const terminal = terminalInstanceRef.current;
      if (terminal && callbacksRef.current.onBeforeUnmount) {
        const cursor = coreRef.current?.getCursor();
        callbacksRef.current.onBeforeUnmount({
          scrollTop: terminal.element.scrollTop,
          cursorY: cursor?.row ?? 0,
          baseY: coreRef.current?.getScrollbackCount() ?? 0,
        });
      }

      managerRef.current?.cleanup();
      managerRef.current = null;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (onScroll && terminal) {
        terminal.element.removeEventListener("scroll", onScroll);
      }
      touchCleanupRef.current?.();
      touchCleanupRef.current = null;
      adapterRef.current?.dispose();
      osc52Filter.reset();
      adapterRef.current = null;
      terminalInstanceRef.current = null;
      coreRef.current = null;
      reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
    };
  }, [sendInput, sessionName, terminalRef, retryGeneration]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    adapter.applyAppearance(isMobile, theme, fontScale);
  }, [isMobile, theme, fontScale]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    touchCleanupRef.current?.();
    touchCleanupRef.current = setupTouchScroll({
      terminal: adapter.terminal,
      core: adapter.core,
      selectModeRef,
      isMobile,
    });
    return () => {
      touchCleanupRef.current?.();
      touchCleanupRef.current = null;
    };
  }, [isMobile]);

  useEffect(() => {
    const terminal = terminalInstanceRef.current;
    if (!terminal || !isActive) return;
    terminal.fit();
    terminal.focus();
  }, [isActive]);

  return {
    connectionState,
    isAtBottom,
    terminalInstanceRef,
    coreRef,
    initializationError,
    scrollToBottom,
    copySelection,
    sendInput,
    sendCommand,
    focus,
    reconnect,
  };
}
