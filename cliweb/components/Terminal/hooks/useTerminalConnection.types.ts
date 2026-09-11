"use client";

import type { RefObject } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";

export interface TerminalScrollState {
  scrollTop: number;
  cursorY: number;
  baseY: number;
}

export interface UseTerminalConnectionProps {
  terminalRef: RefObject<HTMLDivElement | null>;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onBeforeUnmount?: (scrollState: TerminalScrollState) => void;
  initialScrollState?: TerminalScrollState;
  isMobile?: boolean;
  fontScale?: number;
  theme?: string;
  selectMode?: boolean;
}

export interface UseTerminalConnectionReturn {
  connectionState: "connecting" | "connected" | "disconnected" | "reconnecting";
  isAtBottom: boolean;
  xtermRef: RefObject<XTerm | null>;
  scrollToBottom: () => void;
  copySelection: () => boolean;
  sendInput: (data: string) => void;
  sendCommand: (command: string) => void;
  focus: () => void;
  reconnect: () => void;
}
