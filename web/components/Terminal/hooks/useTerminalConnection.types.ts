"use client";

import type { RefObject } from "react";
import type { WTerm } from "@wterm/dom";
import type { GhosttyCore } from "@wterm/ghostty";

export type TerminalConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

export interface TerminalScrollState {
  scrollTop: number;
  cursorY: number;
  baseY: number;
}

export interface UseTerminalConnectionProps {
  terminalRef: RefObject<HTMLDivElement | null>;
  sessionName?: string;
  isActive?: boolean;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onBeforeUnmount?: (scrollState: TerminalScrollState) => void;
  onClipboardWrite?: (text: string) => void;
  onTitle?: (title: string) => void;
  initialScrollState?: TerminalScrollState;
  isMobile?: boolean;
  fontScale?: number;
  theme?: string;
  selectMode?: boolean;
}

export interface UseTerminalConnectionReturn {
  connectionState: TerminalConnectionState;
  isAtBottom: boolean;
  terminalInstanceRef: RefObject<WTerm | null>;
  coreRef: RefObject<GhosttyCore | null>;
  initializationError: string | null;
  scrollToBottom: () => void;
  copySelection: () => boolean;
  sendInput: (data: string) => void;
  sendCommand: (command: string) => void;
  focus: () => void;
  reconnect: () => void;
}
