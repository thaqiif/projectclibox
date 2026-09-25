"use client";

import type { RefObject } from "react";
import type { WTerm } from "@wterm/dom";
import type { GhosttyCore } from "@wterm/ghostty";
import {
  clearWheelRemainder,
  readCopyModePosition,
  topRowText,
} from "./copy-mode";
import {
  closeHistoryView,
  historyViewFor,
  openHistoryView,
  type HistoryPage,
  type HistoryView,
} from "./history-view";
import type { NativePanes, NativeScrollTarget } from "./native-panes";
import {
  createVelocityTracker,
  MOMENTUM_STOP_VELOCITY,
  MOMENTUM_TIME_CONSTANT_MS,
} from "./momentum";
import { createTuiPan } from "./tui-pan";

interface TouchScrollConfig {
  terminal: WTerm;
  core: GhosttyCore;
  selectModeRef: RefObject<boolean>;
  isMobile: boolean;
  /** Panes reported by TUIs that speak the native scroll protocol. */
  nativePanes?: NativePanes;
  /** The shell's scrollback, for scrolling it locally (history-view.ts). */
  requestHistory?: (count: number) => Promise<HistoryPage | null>;
}

const FALLBACK_ROW_HEIGHT = 20;

const GESTURE_SLOP_PX = 8;
// The first page of scrollback is small so it arrives quickly; the rest
// follows in the background.
const HISTORY_FIRST_PAGE = 300;
const HISTORY_FULL = 5000;
// Past this, the gesture scrolls through tmux as before.
const HISTORY_DECISION_TIMEOUT_MS = 350;

export function setupTouchScroll(config: TouchScrollConfig): () => void {
  const {
    terminal,
    core,
    selectModeRef,
    isMobile,
    nativePanes,
    requestHistory,
  } = config;
  if (!isMobile) return () => {};

  const element = terminal.element;
  element.style.touchAction = "none";

  let startX = 0;
  let startY = 0;
  let lastY = 0;
  const velocity = createVelocityTracker();
  let gestureActive = false;
  // normal: WTerm's own scrollback; pan: tmux or a TUI moves the text;
  // history: a local copy of the shell's scrollback; deciding: waiting to
  // hear whether that copy is available.
  let mode: "normal" | "pan" | "history" | "deciding" = "normal";
  let decision = 0;
  let decidingDelta = 0;
  let decidingRelease: number | null = null;
  let history: HistoryView | null = null;
  let rowHeight = FALLBACK_ROW_HEIGHT;
  let scrollDirection: "vertical" | "horizontal" | null = null;
  let inertiaFrame: number | null = null;
  let pendingDeltaY = 0;
  let moveFrame: number | null = null;
  let touchTarget: EventTarget | null = null;

  // Mouse-aware TUIs and tmux copy mode move by whole rows; the pan fills in
  // the pixels between them. Managed sessions are attached through tmux, so
  // WTerm sends mouse reports there even if the Ghostty core cannot observe
  // the app's mouse mode through it. WTerm turns each wheel event into a
  // single report however many lines it spans, so one event per line keeps
  // every report worth exactly one step.
  const pan = createTuiPan({
    element,
    sendWheel: (lines) => {
      clearWheelRemainder(terminal);
      for (let i = 0; i < Math.abs(lines); i += 1) {
        element.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -Math.sign(lines),
            deltaMode: WheelEvent.DOM_DELTA_LINE,
            bubbles: true,
            cancelable: true,
            // TUIs scroll the pane under the pointer: where the swipe began.
            clientX: startX,
            clientY: startY,
          })
        );
      }
    },
  });

  const applyFingerDelta = (deltaY: number) => {
    if (mode === "history") {
      history?.move(deltaY);
    } else if (mode === "deciding") {
      decidingDelta += deltaY;
    } else if (mode === "pan") {
      pan.move(deltaY);
    } else {
      // A finger moving down reveals older output above the current position.
      element.scrollTop -= deltaY;
    }
  };

  // Touch events can arrive faster than the display refreshes. Batch them so
  // each frame does one scroll/wheel dispatch instead of several reflows.
  const flushMove = () => {
    moveFrame = null;
    const deltaY = pendingDeltaY;
    pendingDeltaY = 0;
    if (Math.abs(deltaY) >= 0.1) applyFingerDelta(deltaY);
  };

  const cancelMove = () => {
    if (moveFrame !== null) {
      cancelAnimationFrame(moveFrame);
      moveFrame = null;
    }
    pendingDeltaY = 0;
  };

  const cancelInertia = () => {
    if (inertiaFrame !== null) {
      cancelAnimationFrame(inertiaFrame);
      inertiaFrame = null;
    }
  };

  const measureRowHeight = () => {
    const row = element.querySelector<HTMLElement>(
      ".term-row:not(.term-scrollback-row)"
    );
    const height = row?.getBoundingClientRect().height ?? 0;
    return Number.isFinite(height) && height > 0 ? height : FALLBACK_ROW_HEIGHT;
  };

  /** The native pane under a screen point, if a TUI reported one there. */
  const nativePaneAt = (
    clientX: number,
    clientY: number,
    rowHeight: number
  ): NativeScrollTarget | null => {
    if (!nativePanes) return null;
    const row = element.querySelector<HTMLElement>(
      ".term-grid > .term-row:not(.term-scrollback-row)"
    );
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    // WTerm keeps its measured cell width private; the row width over the
    // column count is within a fraction of a cell of it.
    const measured = (terminal as unknown as { _charWidth?: unknown })
      ._charWidth;
    const charWidth =
      typeof measured === "number" && measured > 0
        ? measured
        : rect.width / Math.max(1, terminal.cols);
    return nativePanes.paneAt(
      Math.floor((clientY - rect.top) / rowHeight),
      Math.floor((clientX - rect.left) / charWidth)
    );
  };

  // A touch keeps targeting the node it started on even after that node
  // leaves the document, and a detached node no longer bubbles to the
  // terminal. WTerm rebuilds a row's spans on every redraw, so a swipe that
  // starts on text would go deaf after the first scroll step. Listening on
  // the start target itself keeps the whole gesture.
  const listenOnTarget = (target: EventTarget | null) => {
    const next = target ?? element;
    if (touchTarget === next) return;
    unlistenTarget();
    touchTarget = next;
    next.addEventListener("touchmove", handleTouchMove as EventListener, {
      passive: false,
    });
    next.addEventListener("touchend", handleTouchEnd);
    next.addEventListener("touchcancel", handleTouchEnd);
  };

  function unlistenTarget() {
    if (!touchTarget) return;
    touchTarget.removeEventListener(
      "touchmove",
      handleTouchMove as EventListener
    );
    touchTarget.removeEventListener("touchend", handleTouchEnd);
    touchTarget.removeEventListener("touchcancel", handleTouchEnd);
    touchTarget = null;
  }

  const handleTouchStart = (event: TouchEvent) => {
    if (selectModeRef.current) return;
    if (event.touches.length !== 1) {
      // A second finger is not a scroll; let the current one end cleanly.
      if (gestureActive) handleTouchEnd();
      return;
    }
    cancelInertia();
    cancelMove();
    listenOnTarget(event.target);
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    lastY = touch.clientY;
    velocity.reset();
    gestureActive = true;
    scrollDirection = null;
    // A touch landing on a moving view catches it, like a native list.
    history = historyViewFor(element);
    if (history) {
      history.stop();
      mode = "history";
    } else if (core.usingAltScreen()) {
      rowHeight = measureRowHeight();
      const native = nativePaneAt(startX, startY, rowHeight);
      const inCopyMode = readCopyModePosition(topRowText(element)) !== null;
      if (!native && !inCopyMode && requestHistory) {
        beginDeciding();
      } else {
        mode = "pan";
        pan.begin(rowHeight, native);
      }
    } else {
      mode = "normal";
    }
    // Do not focus the hidden keyboard textarea here. A swipe is a scroll
    // gesture; tapping still focuses through the normal click handler.
  };

  function handleTouchMove(event: TouchEvent) {
    if (selectModeRef.current || !gestureActive || event.touches.length !== 1)
      return;

    const touch = event.touches[0];
    if (scrollDirection === null) {
      const deltaX = Math.abs(touch.clientX - startX);
      const deltaY = Math.abs(touch.clientY - startY);
      if (deltaX > GESTURE_SLOP_PX || deltaY > GESTURE_SLOP_PX) {
        scrollDirection = deltaX > deltaY ? "horizontal" : "vertical";
        // Start tracking from here so the slop does not jump the view.
        lastY = touch.clientY;
        velocity.add(event.timeStamp, touch.clientY);
      }
      return;
    }
    if (scrollDirection !== "vertical") return;

    if (event.cancelable) event.preventDefault();
    event.stopPropagation();

    const deltaY = touch.clientY - lastY;
    lastY = touch.clientY;
    velocity.add(event.timeStamp, touch.clientY);
    pendingDeltaY += deltaY;
    if (moveFrame === null) moveFrame = requestAnimationFrame(flushMove);
  }

  /**
   * Ask for the shell's scrollback. A plain shell answers with it and the
   * gesture scrolls a local copy; anything else (a full-screen app, a split
   * window) or no answer in time scrolls through tmux as before. Finger
   * travel in the meantime is kept and applied either way.
   */
  function beginDeciding() {
    mode = "deciding";
    decidingDelta = 0;
    decidingRelease = null;
    const token = (decision += 1);
    const timer = setTimeout(
      () => decide(token, null),
      HISTORY_DECISION_TIMEOUT_MS
    );
    void requestHistory!(HISTORY_FIRST_PAGE).then((page) => {
      clearTimeout(timer);
      decide(token, page);
    });
  }

  function decide(token: number, page: HistoryPage | null) {
    if (token !== decision || mode !== "deciding") return;
    const view = page ? openHistoryView(element, page, rowHeight) : null;
    if (view) {
      mode = "history";
      history = view;
      view.move(decidingDelta);
      if (decidingRelease !== null) releaseHistory(decidingRelease);
      // The rest of the scrollback, while the first screens are read.
      void requestHistory!(HISTORY_FULL).then((full) => {
        if (full && historyViewFor(element) === view) view.replace(full);
      });
      return;
    }
    mode = "pan";
    pan.begin(rowHeight, null);
    pan.move(decidingDelta);
    if (decidingRelease !== null) pan.fling(decidingRelease);
  }

  function releaseHistory(velocity: number) {
    const view = history;
    view?.fling(velocity, () => {
      // Back at the bottom: the live terminal takes over again.
      if (view.atLive()) view.close();
    });
  }

  const startInertia = (initial: number) => {
    let velocity = initial;
    if (velocity === 0) return;

    let previousFrameTime = 0;
    const animate = (time: number) => {
      if (selectModeRef.current) {
        inertiaFrame = null;
        return;
      }

      const elapsed =
        previousFrameTime === 0 ? 16 : Math.min(32, time - previousFrameTime);
      previousFrameTime = time;
      const deltaY = velocity * elapsed;
      if (Math.abs(deltaY) >= 0.1) applyFingerDelta(deltaY);
      velocity *= Math.exp(-elapsed / MOMENTUM_TIME_CONSTANT_MS);

      if (Math.abs(velocity) > MOMENTUM_STOP_VELOCITY) {
        inertiaFrame = requestAnimationFrame(animate);
      } else {
        inertiaFrame = null;
      }
    };

    inertiaFrame = requestAnimationFrame(animate);
  };

  function handleTouchEnd(event?: Event) {
    unlistenTarget();
    if (!gestureActive) return;
    gestureActive = false;
    if (moveFrame !== null) {
      cancelAnimationFrame(moveFrame);
      flushMove();
    }
    // Only a real flick coasts (see momentum.ts).
    const release =
      scrollDirection === "vertical" && !selectModeRef.current
        ? velocity.release(event?.timeStamp ?? performance.now())
        : 0;
    if (mode === "history") {
      releaseHistory(release);
    } else if (mode === "deciding") {
      decidingRelease = release;
    } else if (mode === "pan") {
      // Always called, even for taps: it also lets go of the pan.
      pan.fling(release);
    } else {
      startInertia(release);
    }
  }

  element.addEventListener("touchstart", handleTouchStart, { passive: true });

  return () => {
    cancelInertia();
    cancelMove();
    unlistenTarget();
    pan.dispose();
    decision += 1;
    closeHistoryView(element);
    element.removeEventListener("touchstart", handleTouchStart);
    element.style.touchAction = "";
  };
}
