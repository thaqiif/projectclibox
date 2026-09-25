"use client";

/**
 * tmux copy mode, as seen from the browser.
 *
 * Scrolling a shell inside tmux enters copy mode, which draws a
 * `[position/history]` indicator at the right end of the top row. It tells
 * exactly how far the view can still move each way, which is what lets touch
 * scrolling stop dead at either end instead of guessing.
 *
 * Copy mode also swallows keys: in vi mode `g` jumps to the top of history,
 * so typing `git status` after a scroll would hide the prompt. Terminals such
 * as Termius return to the prompt as soon as you type; `q` cancels copy mode
 * in both vi and emacs key tables, so it is sent ahead of the input.
 */

export interface CopyModePosition {
  /** Lines scrolled up from the live screen. */
  position: number;
  /** Lines of history available above the live screen. */
  history: number;
}

export function readCopyModePosition(
  topRow: string | null | undefined
): CopyModePosition | null {
  if (!topRow) return null;
  const match = /\[(\d+)\/(\d+)\]\s*$/.exec(topRow);
  if (!match) return null;
  const position = Number(match[1]);
  const history = Number(match[2]);
  return position <= history ? { position, history } : null;
}

export function topRowText(element: Element): string | null {
  return (
    element.querySelector(".term-grid > .term-row:not(.term-scrollback-row)")
      ?.textContent ?? null
  );
}

// Mouse reports, focus reports and paging keep copy mode; everything else
// is typing and should land at the prompt.
const KEEPS_COPY_MODE = /^\x1b\[(?:<|M|I$|O$|5~$|6~$)/;

export interface CopyModeExit {
  /** Returns what to send ahead of `data` (either "" or "q"). */
  prefixFor(data: string): string;
  dispose(): void;
}

export function createCopyModeExit(element: HTMLElement): CopyModeExit {
  // Only act after a wheel gesture could have entered copy mode, so a shell
  // line that merely ends in "[3/10]" never gets a stray `q`.
  let wheelSinceLive = false;
  const onWheel = () => {
    wheelSinceLive = true;
  };
  element.addEventListener("wheel", onWheel, { capture: true, passive: true });

  return {
    prefixFor(data) {
      if (!wheelSinceLive || data === "" || KEEPS_COPY_MODE.test(data)) {
        return "";
      }
      if (!readCopyModePosition(topRowText(element))) {
        wheelSinceLive = false;
        return "";
      }
      wheelSinceLive = false;
      return "q";
    },
    dispose() {
      element.removeEventListener("wheel", onWheel, { capture: true });
    },
  };
}

/**
 * WTerm carries fractions of a line between wheel events. A leftover from a
 * trackpad or mouse notch in the other direction would swallow the next
 * single-line event, so it is cleared before sending them. (`input` is
 * private in WTerm's types; the guard keeps this a no-op if it moves.)
 */
export function clearWheelRemainder(terminal: unknown): void {
  const input = (terminal as { input?: { wheelPartialScroll?: unknown } })
    .input;
  if (input && typeof input.wheelPartialScroll === "number") {
    input.wheelPartialScroll = 0;
  }
}

/**
 * Desktop wheel and trackpad scrolling while tmux copy mode is showing.
 *
 * Touch scrolling needs tmux to move exactly one line per wheel report, so
 * the copy-mode bindings do that (lib/terminals.ts). WTerm, however, sends a
 * single report per wheel event however far it scrolls, which would make a
 * mouse notch move one line. While the indicator shows copy mode, a real
 * wheel event is replaced by one single-line event per line it covers: a
 * trackpad then tracks the fingers, and a notch moves about five lines as
 * tmux's own default did. Full-screen apps are left exactly as WTerm
 * handles them.
 */
export function createCopyModeWheel(
  element: HTMLElement,
  getRowHeight: () => number,
  beforeDispatch: () => void = () => {}
): () => void {
  let remainder = 0;
  const onWheel = (event: WheelEvent) => {
    // Our own single-line events (and touch scrolling's) pass through.
    if (!event.isTrusted || event.deltaY === 0 || event.shiftKey) return;
    if (!readCopyModePosition(topRowText(element))) {
      remainder = 0;
      return;
    }
    const rowHeight = getRowHeight();
    if (!(rowHeight > 0)) return;
    let lines = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) lines /= rowHeight;
    else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      lines *= Math.max(1, Math.floor(element.clientHeight / rowHeight));
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    // Carry fractions (trackpads) in one direction only, and allow for
    // float error so five 17px-row notches of 100px land on whole lines.
    if (Math.sign(remainder) === -Math.sign(lines)) remainder = 0;
    remainder += lines;
    const whole = Math.trunc(remainder + Math.sign(remainder) * 1e-6);
    remainder -= whole;
    if (whole !== 0) beforeDispatch();
    for (let i = 0; i < Math.min(Math.abs(whole), 50); i += 1) {
      element.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: Math.sign(whole),
          deltaMode: WheelEvent.DOM_DELTA_LINE,
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
        })
      );
    }
  };
  element.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => element.removeEventListener("wheel", onWheel, { capture: true });
}
