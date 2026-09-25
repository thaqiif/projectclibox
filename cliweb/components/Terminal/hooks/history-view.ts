"use client";

import { ansiLineToHtml } from "./ansi-html";

/**
 * A shell's scrollback, scrolled entirely in the browser.
 *
 * Like a native list, the rows are already here: the history arrives once
 * (lib/tmux-history.ts) and scrolling it needs no round trip, so it moves at
 * the display's frame rate however fast the finger or the network. Only the
 * rows on screen plus one screen either side exist in the DOM; they are
 * recycled as the view moves, and the moving layer is a single transform.
 *
 * The view opens showing exactly the live screen, so opening it is
 * invisible, and it closes itself when scrolled back to the bottom.
 */

export interface HistoryPage {
  /** Oldest first; the last `height` lines are the visible screen. */
  lines: string[];
  height: number;
  historySize: number;
}

export interface HistoryView {
  /** Finger travel in px; positive (finger down) reveals older output. */
  move(fingerDeltaY: number): void;
  /** Momentum after release, in px/ms; `onRest` runs when it stops. */
  fling(velocity: number, onRest?: () => void): void;
  stop(): void;
  /** Swap in a fuller or newer capture, keeping the same text in view. */
  replace(page: HistoryPage): void;
  /** Scrolled all the way down: showing the live screen. */
  atLive(): boolean;
  close(): void;
}

const FLING_TIME_CONSTANT_MS = 325;
const MIN_FLING_VELOCITY = 0.02;
const views = new WeakMap<HTMLElement, HistoryView>();

export function historyViewFor(element: HTMLElement): HistoryView | null {
  return views.get(element) ?? null;
}

export function closeHistoryView(element: HTMLElement): void {
  views.get(element)?.close();
}

export function openHistoryView(
  element: HTMLElement,
  page: HistoryPage,
  rowHeight: number,
  options: {
    requestFrame?: (callback: (time: number) => void) => number;
    cancelFrame?: (handle: number) => void;
  } = {}
): HistoryView | null {
  const grid = element.querySelector<HTMLElement>(".term-grid");
  if (!grid || page.lines.length < page.height || rowHeight <= 0) return null;
  views.get(element)?.close();
  const requestFrame =
    options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));

  let lines = page.lines;
  let html: Array<string | undefined> = [];
  let historySize = page.historySize;
  const height = page.height;
  let offset = 0; // px scrolled up from the live screen
  let flingFrame: number | null = null;
  let firstShown = -1;
  let closed = false;
  const shown = new Map<number, HTMLElement>();
  const spare: HTMLElement[] = [];

  const overlay = element.ownerDocument.createElement("div");
  overlay.className = "history-view";
  const rows = element.ownerDocument.createElement("div");
  rows.className = "history-rows";
  overlay.appendChild(rows);
  const place = () => {
    overlay.style.top = `${grid.offsetTop}px`;
    overlay.style.left = `${grid.offsetLeft}px`;
    overlay.style.width = `${grid.clientWidth}px`;
    overlay.style.height = `${height * rowHeight}px`;
  };
  place();
  element.appendChild(overlay);

  const maxOffset = () => Math.max(0, (lines.length - height) * rowHeight);

  const render = () => {
    const top = (lines.length - height) * rowHeight - offset;
    rows.style.transform = `translate3d(0, ${-top}px, 0)`;
    const first = Math.floor(top / rowHeight);
    if (first === firstShown) return;
    firstShown = first;
    // One screen of rows either side is ready before it scrolls in.
    const from = Math.max(0, first - height);
    const to = Math.min(lines.length - 1, first + 2 * height);
    for (const [index, row] of shown) {
      if (index < from || index > to) {
        shown.delete(index);
        spare.push(row);
      }
    }
    for (let index = from; index <= to; index += 1) {
      if (shown.has(index)) continue;
      const row =
        spare.pop() ??
        rows.appendChild(element.ownerDocument.createElement("div"));
      row.className = "history-row";
      row.style.top = `${index * rowHeight}px`;
      row.innerHTML = html[index] ??= ansiLineToHtml(lines[index]);
      shown.set(index, row);
    }
    for (const row of spare) row.style.top = "-100000px";
  };

  const cancelFling = () => {
    if (flingFrame !== null) cancelFrame(flingFrame);
    flingFrame = null;
  };

  const setOffset = (next: number) => {
    offset = Math.max(0, Math.min(maxOffset(), next));
    render();
  };

  const view: HistoryView = {
    move(delta) {
      if (closed) return;
      cancelFling();
      setOffset(offset + delta);
    },

    fling(velocity, onRest) {
      cancelFling();
      if (closed) return;
      if (Math.abs(velocity) < MIN_FLING_VELOCITY) {
        onRest?.();
        return;
      }
      let v = velocity;
      let previous: number | null = null;
      const frame = (time: number) => {
        const elapsed = previous === null ? 16 : Math.min(32, time - previous);
        previous = time;
        const before = offset;
        setOffset(offset + v * elapsed);
        v *= Math.exp(-elapsed / FLING_TIME_CONSTANT_MS);
        // Momentum stops dead at either end rather than bouncing.
        if (Math.abs(v) < MIN_FLING_VELOCITY || offset === before) {
          flingFrame = null;
          onRest?.();
          return;
        }
        flingFrame = requestFrame(frame);
      };
      flingFrame = requestFrame(frame);
    },

    stop: cancelFling,

    replace(next) {
      if (closed || next.height !== height) return;
      // Output that scrolled into history since the last capture pushed
      // everything up; follow it so the same text stays in view.
      const grown = next.historySize - historySize;
      lines = next.lines;
      html = [];
      historySize = next.historySize;
      firstShown = -1;
      for (const [, row] of shown) spare.push(row);
      shown.clear();
      setOffset(offset > 0 ? offset + Math.max(0, grown) * rowHeight : 0);
    },

    atLive: () => offset <= 0.5,

    close() {
      if (closed) return;
      closed = true;
      cancelFling();
      overlay.remove();
      if (views.get(element) === view) views.delete(element);
    },
  };

  views.set(element, view);
  render();
  return view;
}
