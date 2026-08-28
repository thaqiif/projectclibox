"use client";

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { CanvasAddon } from "@xterm/addon-canvas";
import { getTerminalThemeForApp } from "../constants";
import { DEFAULT_FONT_SCALE } from "../../../lib/font-scale";
import { getTerminalFontSize } from "./terminal-font-size";

export interface TerminalInstance {
  term: XTerm;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  cleanup: () => void;
}

export function createTerminal(
  container: HTMLElement,
  isMobile: boolean,
  theme: string,
  fontScale = DEFAULT_FONT_SCALE
): TerminalInstance {
  const fontSize = getTerminalFontSize(isMobile, fontScale);
  const terminalTheme = getTerminalThemeForApp(theme || "dark");

  const term = new XTerm({
    cursorBlink: true,
    fontSize,
    fontFamily:
      '"JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace',
    fontWeight: "400",
    fontWeightBold: "600",
    letterSpacing: 0,
    lineHeight: isMobile ? 1.15 : 1.2,
    scrollback: 15000,
    scrollSensitivity: isMobile ? 3 : 1,
    fastScrollSensitivity: 5,
    smoothScrollDuration: 100,
    cursorStyle: "bar",
    cursorWidth: 2,
    allowProposedApi: true,
    // Right-click belongs to the TUI, not to xterm and not to the browser.
    // xterm would otherwise select the word under the cursor, which fights
    // with any app that tracks the mouse itself.
    rightClickSelectsWord: false,
    theme: terminalTheme,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(searchAddon);
  term.open(container);
  term.loadAddon(new CanvasAddon());
  fitAddon.fit();

  // Helper to copy text to clipboard with fallback
  const copyToClipboard = (text: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        // Fallback if clipboard API fails
        execCommandCopy(text);
      });
    } else {
      // Fallback for non-secure contexts
      execCommandCopy(text);
    }
  };

  const execCommandCopy = (text: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  // Handle Cmd+A and Cmd+C via document event listener (more reliable than attachCustomKeyEventHandler)
  const handleKeyDown = (event: KeyboardEvent) => {
    // Only handle when terminal is focused (xterm creates its textarea inside the container)
    if (!container.contains(document.activeElement)) return;

    const key = event.key.toLowerCase();

    // Cmd+A (macOS) / Ctrl+A for select all
    if ((event.metaKey || event.ctrlKey) && key === "a") {
      event.preventDefault();
      event.stopPropagation();
      term.selectAll();
      return;
    }

    // Cmd+C (macOS) / Ctrl+C for copy when text is selected
    if ((event.metaKey || event.ctrlKey) && key === "c") {
      const selection = term.getSelection();
      if (selection) {
        event.preventDefault();
        event.stopPropagation();
        copyToClipboard(selection);
      }
    }
  };

  // Use capture phase to intercept before browser default
  document.addEventListener("keydown", handleKeyDown, true);

  // Suppress the desktop browser context menu over the terminal.
  //
  // When the running TUI has mouse reporting on (DECSET 1000/1002/1003),
  // xterm already encodes the right-click and writes it to the PTY, so the
  // app draws its own menu — the native one on top of that is pure noise.
  // When mouse reporting is off, right-click should simply do nothing
  // rather than opening a browser menu over the pane. preventDefault covers
  // both cases without swallowing the event xterm needs to see.
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  container.addEventListener("contextmenu", handleContextMenu);

  const cleanup = () => {
    document.removeEventListener("keydown", handleKeyDown, true);
    container.removeEventListener("contextmenu", handleContextMenu);
  };

  return { term, fitAddon, searchAddon, cleanup };
}

export function updateTerminalForMobile(
  term: XTerm,
  fitAddon: FitAddon,
  isMobile: boolean,
  sendResize: (cols: number, rows: number) => void,
  fontScale = DEFAULT_FONT_SCALE
): void {
  const newFontSize = getTerminalFontSize(isMobile, fontScale);
  const newLineHeight = isMobile ? 1.15 : 1.2;

  if (
    term.options.fontSize !== newFontSize ||
    term.options.lineHeight !== newLineHeight
  ) {
    term.options.fontSize = newFontSize;
    term.options.lineHeight = newLineHeight;
    term.refresh(0, term.rows - 1);
    fitAddon.fit();
    sendResize(term.cols, term.rows);
  }
}

export function updateTerminalTheme(term: XTerm, theme: string): void {
  const terminalTheme = getTerminalThemeForApp(theme || "dark");
  term.options.theme = terminalTheme;
}
