"use client";

import { WTerm } from "@wterm/dom";
import type { CellData } from "@wterm/core";
import { GhosttyCore } from "@wterm/ghostty";
import { getTerminalThemeForApp } from "../constants";
import { DEFAULT_FONT_SCALE } from "../../../lib/font-scale";
import { clampTerminalGrid } from "../../../lib/terminal-grid";
import { getTerminalFontSize } from "./terminal-font-size";

const SCROLLBACK_BYTES = 64 * 1024 * 1024;
const IMAGE_STORAGE_BYTES = 32 * 1024 * 1024;

export interface TerminalEngineAdapter {
  readonly core: GhosttyCore;
  readonly terminal: WTerm;
  applyAppearance(isMobile: boolean, theme: string, fontScale: number): void;
  syncHostState(): void;
  fit(): void;
  dispose(): void;
}

function packedColor(color: string): number {
  const match = /^#?([\da-f]{6})$/iu.exec(color.trim());
  return match ? Number.parseInt(match[1]!, 16) : 0;
}

function cssColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

function linkifyTextNode(node: Text, document: Document): boolean {
  const value = node.data;
  const expression = /https?:\/\/[^\s<>"'`]+/giu;
  const matches = [...value.matchAll(expression)];
  if (matches.length === 0) return false;

  const fragment = document.createDocumentFragment();
  let offset = 0;
  let changed = false;
  for (const match of matches) {
    const index = match.index ?? 0;
    const candidate = match[0];
    let urlText = candidate;
    while (/[),.;:!?\]}]$/u.test(urlText)) urlText = urlText.slice(0, -1);
    if (urlText.length < 8 || urlText.length > 2048) continue;

    let url: URL;
    try {
      url = new URL(urlText);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;

    fragment.append(document.createTextNode(value.slice(offset, index)));
    const anchor = document.createElement("a");
    anchor.className = "term-link term-bare-link";
    anchor.href = url.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = urlText;
    anchor.addEventListener("click", (event) => {
      const platform = document.defaultView?.navigator.platform ?? "";
      const navigator = document.defaultView?.navigator;
      const touchDevice = (navigator?.maxTouchPoints ?? 0) > 0;
      if (touchDevice && !event.metaKey && !event.ctrlKey) {
        // WTerm's parent click handler blocks unmodified desktop links. Let
        // an ordinary mobile tap open links in their safe, separate tab.
        event.stopPropagation();
        return;
      }
      const macLike = /Mac|iPhone|iPad/u.test(platform);
      if (!(macLike ? event.metaKey : event.ctrlKey)) event.preventDefault();
    });
    fragment.append(anchor);
    offset = index + urlText.length;
    changed = true;
  }
  if (!changed) return false;
  fragment.append(document.createTextNode(value.slice(offset)));
  node.replaceWith(fragment);
  return true;
}

function setupBareUrlLinks(element: HTMLElement): () => void {
  const document = element.ownerDocument;
  const linkifyRows = (root: ParentNode) => {
    const rows =
      root instanceof HTMLElement && root.matches(".term-row")
        ? [root]
        : Array.from(root.querySelectorAll<HTMLElement>(".term-row"));
    for (const row of rows) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node.parentElement?.closest("a,.term-link")) continue;
        textNodes.push(node);
      }
      for (const node of textNodes) linkifyTextNode(node, document);
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) linkifyRows(node);
        else if (node.parentElement) linkifyRows(node.parentElement);
      }
    }
  });
  observer.observe(element, { subtree: true, childList: true });
  linkifyRows(element);
  return () => observer.disconnect();
}

function setAppearance(
  element: HTMLElement,
  isMobile: boolean,
  theme: string,
  fontScale: number
): void {
  const colors = getTerminalThemeForApp(theme || "dark");
  const ansi = [
    colors.black,
    colors.red,
    colors.green,
    colors.yellow,
    colors.blue,
    colors.magenta,
    colors.cyan,
    colors.white,
    colors.brightBlack,
    colors.brightRed,
    colors.brightGreen,
    colors.brightYellow,
    colors.brightBlue,
    colors.brightMagenta,
    colors.brightCyan,
    colors.brightWhite,
  ];

  element.style.setProperty("--term-bg", colors.background);
  element.style.setProperty("--term-fg", colors.foreground);
  element.style.setProperty("--term-cursor-theme", colors.cursor);
  element.style.setProperty("--term-cursor", colors.cursor);
  element.style.setProperty("--term-selection", colors.selectionBackground);
  element.style.setProperty(
    "--term-font-family",
    '"JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace'
  );
  element.style.setProperty(
    "--term-font-size",
    `${getTerminalFontSize(isMobile, fontScale || DEFAULT_FONT_SCALE)}px`
  );
  element.style.setProperty("--term-line-height", isMobile ? "1.15" : "1.2");
  ansi.forEach((color, index) => {
    element.style.setProperty(`--term-color-${index}`, color);
  });
}

export async function createTerminalEngineAdapter(
  element: HTMLElement,
  options: {
    isMobile: boolean;
    theme: string;
    fontScale?: number;
    onData: (data: string) => void;
    onResize: (cols: number, rows: number) => void;
    onTitle?: (title: string) => void;
  }
): Promise<TerminalEngineAdapter> {
  const colors = getTerminalThemeForApp(options.theme || "dark");
  const core = await GhosttyCore.load({
    wasmPath: "/ghostty-vt.wasm",
    scrollbackLimit: SCROLLBACK_BYTES,
    imageStorageLimit: IMAGE_STORAGE_BYTES,
    foregroundColor: colors.foreground,
    backgroundColor: colors.background,
  });

  element.classList.add("wterm", "wterm-cliweb");
  setAppearance(
    element,
    options.isMobile,
    options.theme,
    options.fontScale ?? DEFAULT_FONT_SCALE
  );

  const terminal = new WTerm(element, {
    cols: 80,
    rows: 24,
    core,
    autoResize: true,
    cursorBlink: false,
    onData: options.onData,
    onResize: options.onResize,
    onTitle: options.onTitle,
  });

  try {
    await terminal.init();
  } catch (error) {
    terminal.destroy();
    core.dispose();
    element.classList.remove("wterm", "wterm-cliweb");
    throw error;
  }

  const cleanupLinks = setupBareUrlLinks(element);

  const syncHostState = () => {
    const terminalColors = core.getTerminalColors();
    element.style.setProperty("--term-fg", cssColor(terminalColors.foreground));
    element.style.setProperty("--term-bg", cssColor(terminalColors.background));

    const cursorColor = core.getCursorColor();
    element.style.setProperty(
      "--term-cursor",
      cursorColor === null ? "var(--term-cursor-theme)" : cssColor(cursorColor)
    );
    element.classList.toggle("cursor-blink", core.cursorBlinking());
    const cursorStyle = core.getCursorStyle();
    element.classList.toggle(
      "cursor-shape-underline",
      cursorStyle === "underline"
    );
    element.classList.toggle("cursor-shape-bar", cursorStyle === "bar");
    element.classList.toggle(
      "cursor-shape-hollow",
      cursorStyle === "block-hollow"
    );
  };

  const adapter: TerminalEngineAdapter = {
    core,
    terminal,
    applyAppearance(isMobile, theme, fontScale) {
      setAppearance(element, isMobile, theme, fontScale);
      const colors = getTerminalThemeForApp(theme || "dark");
      core.setDefaultColors(
        packedColor(colors.foreground),
        packedColor(colors.background)
      );
      syncHostState();
      terminal.write("");
      // WTerm owns font metrics and grid fitting; the app only asks it to
      // recalculate after changing the CSS font properties.
      terminal.fit();
    },
    syncHostState,
    fit() {
      terminal.fit();
    },
    dispose() {
      cleanupLinks();
      terminal.destroy();
      core.dispose();
      element.classList.remove("wterm", "wterm-cliweb");
    },
  };

  // The initial WebSocket hello uses this fitted grid rather than a guessed
  // terminal size. ResizeObserver remains WTerm's only ongoing fit owner.
  terminal.fit();
  syncHostState();
  return adapter;
}

function cellText(cell: CellData): string {
  if (cell.width === 0) return "";
  if (cell.chars) return cell.chars;
  return String.fromCodePoint(cell.char || 0x20);
}

function trimRight(value: string): string {
  return value.replace(/[ \t]+$/u, "");
}

/** Build selectable text from Ghostty's complete retained history. */
export function terminalHistoryText(core: GhosttyCore): string {
  const lines: string[] = [];
  const cols = core.getCols();
  const scrollback = core.getScrollbackCount();

  for (let line = 0; line < scrollback; line += 1) {
    const offset = scrollback - line - 1;
    const len = Math.min(cols, Math.max(0, core.getScrollbackLineLen(offset)));
    let text = "";
    for (let col = 0; col < len; col += 1) {
      text += cellText(core.getScrollbackCell(offset, col));
    }
    lines.push(trimRight(text));
  }

  for (let row = 0; row < core.getRows(); row += 1) {
    let text = "";
    for (let col = 0; col < cols; col += 1) {
      text += cellText(core.getCell(row, col));
    }
    lines.push(trimRight(text));
  }

  return lines.join("\n");
}

export function setTerminalScrollBottom(terminal: WTerm): void {
  terminal.element.scrollTop = terminal.element.scrollHeight;
}

export function restoreTerminalScroll(
  terminal: WTerm,
  scrollTop: number | undefined
): void {
  if (typeof scrollTop === "number" && Number.isFinite(scrollTop)) {
    terminal.element.scrollTop = scrollTop;
  }
}

export function fittedGrid(terminal: WTerm) {
  return clampTerminalGrid(terminal.cols, terminal.rows);
}
