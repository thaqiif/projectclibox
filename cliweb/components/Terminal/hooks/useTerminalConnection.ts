"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { WTerm } from "@wterm/dom";
import type { GhosttyCore, HostResourceRequest } from "@wterm/ghostty";
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
import {
  clearWheelRemainder,
  createCopyModeExit,
  createCopyModeWheel,
  type CopyModeExit,
} from "./copy-mode";
import { keepKeyboardInputInView } from "./keyboard-input";
import { createNativePanes } from "./native-panes";
import { setupTouchScroll } from "./touch-scroll";
import { createWebSocketConnection } from "./websocket-connection";
import { DEFAULT_FONT_SCALE } from "../../../lib/font-scale";
import { Osc52Filter } from "../../../lib/osc52-filter";
import {
  TERMINAL_RESOURCE_MAX_BYTES,
  TERMINAL_RESOURCE_PROTOCOL_VERSION,
} from "../../../lib/terminal-resource-protocol";
import { WS_RECONNECT_BASE_DELAY } from "../constants";

export type { TerminalScrollState } from "./useTerminalConnection.types";

function rowHeightOf(element: HTMLElement): number {
  return (
    element
      .querySelector(".term-row:not(.term-scrollback-row)")
      ?.getBoundingClientRect().height ?? 0
  );
}

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
  const adapterRef = useRef<Awaited<
    ReturnType<typeof createTerminalEngineAdapter>
  > | null>(null);
  const managerRef = useRef<ReturnType<
    typeof createWebSocketConnection
  > | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const reconnectDelayRef = useRef<number>(WS_RECONNECT_BASE_DELAY);
  const intentionalCloseRef = useRef<boolean>(false);
  const selectModeRef = useRef(selectMode);
  const activeRef = useRef(isActive);
  const appearanceRef = useRef({ isMobile, theme, fontScale });
  const initialScrollTopRef = useRef(initialScrollState?.scrollTop);
  const touchCleanupRef = useRef<(() => void) | null>(null);
  const copyModeExitRef = useRef<CopyModeExit | null>(null);
  const keyboardInputCleanupRef = useRef<(() => void) | null>(null);
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

  // Typing after a scroll returns to the prompt instead of being read as
  // tmux copy-mode commands (see copy-mode.ts).
  const sendInput = useCallback((data: string) => {
    const prefix = copyModeExitRef.current?.prefixFor(data) ?? "";
    managerRef.current?.sendInput(prefix + data);
  }, []);
  // Panes reported by TUIs that support native scrolling (jcode).
  const [nativePanes] = useState(() => createNativePanes());
  const sendCommand = useCallback((command: string) => {
    const prefix = copyModeExitRef.current?.prefixFor(command) ?? "";
    if (prefix) managerRef.current?.sendInput(prefix);
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
    nativePanes.setSender((pane, delta) =>
      managerRef.current?.sendNativeScroll(pane, delta)
    );

    let cancelled = false;
    let onScroll: (() => void) | null = null;
    const pendingResources = new Map<
      number,
      { request: HostResourceRequest; chunks: Uint8Array[]; length: number }
    >();
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
      // The viewport is classified (mobile or not) a frame after mount, while
      // the adapter was already loading with the first guess, and the
      // appearance effect skipped it because it did not exist yet. Apply
      // whatever is current now.
      const appearance = appearanceRef.current;
      adapter.applyAppearance(
        appearance.isMobile,
        appearance.theme,
        appearance.fontScale
      );
      terminalInstanceRef.current = adapter.terminal;
      coreRef.current = adapter.core;

      const failResource = (id: number, cancelOnServer: boolean) => {
        pendingResources.delete(id);
        if (cancelOnServer) managerRef.current?.cancelResource(id);
        if (adapter.core.rejectResourceRequest(id)) {
          adapter.terminal.write("");
          adapter.syncHostState();
        }
      };

      const handleResourceFrame = (
        header: Record<string, unknown>,
        bytes: Uint8Array
      ) => {
        const id = header.id;
        if (
          header.version !== TERMINAL_RESOURCE_PROTOCOL_VERSION ||
          typeof id !== "number" ||
          !Number.isSafeInteger(id) ||
          id <= 0
        ) {
          return;
        }
        const pending = pendingResources.get(id);
        if (!pending) return;

        if (header.type === "ack") return;
        if (header.type === "rejected") {
          failResource(id, false);
          return;
        }
        if (header.type === "cancelled") {
          pendingResources.delete(id);
          adapter.core.cancelResourceRequest(id);
          return;
        }
        if (
          header.type !== "chunk" ||
          typeof header.offset !== "number" ||
          !Number.isSafeInteger(header.offset) ||
          header.offset !== pending.length ||
          typeof header.complete !== "boolean" ||
          bytes.byteLength > 256 * 1024 ||
          pending.length + bytes.byteLength > TERMINAL_RESOURCE_MAX_BYTES
        ) {
          failResource(id, true);
          return;
        }

        if (bytes.byteLength > 0) {
          pending.chunks.push(bytes.slice());
          pending.length += bytes.byteLength;
        }
        if (!header.complete) return;

        if (
          typeof header.total !== "number" ||
          !Number.isSafeInteger(header.total) ||
          header.total !== pending.length ||
          (pending.request.length > 0 &&
            pending.length > pending.request.length)
        ) {
          failResource(id, true);
          return;
        }

        const resourceBytes = new Uint8Array(pending.length);
        let offset = 0;
        for (const chunk of pending.chunks) {
          resourceBytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        pendingResources.delete(id);
        if (adapter.core.completeResourceRequest(id, resourceBytes)) {
          adapter.terminal.write("");
          adapter.syncHostState();
        } else if (adapter.core.rejectResourceRequest(id)) {
          adapter.terminal.write("");
          adapter.syncHostState();
        }
      };

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
      copyModeExitRef.current = createCopyModeExit(adapter.terminal.element);
      const keyboardCleanup = keepKeyboardInputInView(adapter.terminal.element);
      const wheelCleanup = createCopyModeWheel(
        adapter.terminal.element,
        () => rowHeightOf(adapter.terminal.element),
        () => clearWheelRemainder(adapter.terminal)
      );
      keyboardInputCleanupRef.current = () => {
        keyboardCleanup();
        wheelCleanup();
      };
      touchCleanupRef.current = setupTouchScroll({
        terminal: adapter.terminal,
        core: adapter.core,
        selectModeRef,
        isMobile: appearanceRef.current.isMobile,
        nativePanes,
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
          onDisconnected: () => {
            for (const id of pendingResources.keys()) {
              adapter.core.cancelResourceRequest(id);
            }
            pendingResources.clear();
            callbacksRef.current.onDisconnected?.();
          },
          onConnectionStateChange: setConnectionState,
          onFatalError: setInitializationError,
          onResourceFrame: handleResourceFrame,
          onNativeScroll: (panes) => nativePanes.update(panes),
          onOutput: (data) => {
            const result = osc52Filter.push(data);
            if (result.terminalData) {
              adapter.terminal.write(result.terminalData);
              adapter.syncHostState();
              for (const request of adapter.core.drainResourceRequests()) {
                pendingResources.set(request.id, {
                  request,
                  chunks: [],
                  length: 0,
                });
                if (!managerRef.current?.requestResource(request)) {
                  failResource(request.id, false);
                }
              }
            }
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
        error instanceof Error
          ? error.message
          : "Terminal initialization failed";
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
      copyModeExitRef.current?.dispose();
      copyModeExitRef.current = null;
      keyboardInputCleanupRef.current?.();
      keyboardInputCleanupRef.current = null;
      adapterRef.current?.dispose();
      osc52Filter.reset();
      adapterRef.current = null;
      terminalInstanceRef.current = null;
      coreRef.current = null;
      reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
    };
  }, [sendInput, sessionName, terminalRef, retryGeneration, nativePanes]);

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
      nativePanes,
    });
    return () => {
      touchCleanupRef.current?.();
      touchCleanupRef.current = null;
    };
  }, [isMobile, nativePanes]);

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
