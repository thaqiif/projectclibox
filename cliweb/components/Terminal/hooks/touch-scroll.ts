"use client";

import type { RefObject } from "react";
import type { WTerm } from "@wterm/dom";
import type { GhosttyCore } from "@wterm/ghostty";
import { createTuiPan } from "./tui-pan";

interface TouchScrollConfig {
  terminal: WTerm;
  core: GhosttyCore;
  selectModeRef: RefObject<boolean>;
  isMobile: boolean;
}

const FALLBACK_ROW_HEIGHT = 20;
const TOUCH_INERTIA_DECAY_MS = 325;
const TOUCH_VELOCITY_SAMPLE_WEIGHT = 0.45;
const MIN_INERTIA_VELOCITY = 0.015;

export function setupTouchScroll(config: TouchScrollConfig): () => void {
  const { terminal, core, selectModeRef, isMobile } = config;
  if (!isMobile) return () => {};

  const element = terminal.element;
  element.style.touchAction = "none";

  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let lastTouchTime = 0;
  let velocityY = 0;
  let gestureActive = false;
  let scrollDirection: "vertical" | "horizontal" | null = null;
  let tuiRowHeight = FALLBACK_ROW_HEIGHT;
  let inertiaFrame: number | null = null;
  let pendingDeltaY = 0;
  let moveFrame: number | null = null;

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

  // Mouse-aware TUIs and tmux copy mode move by whole rows; the pan fills in
  // the pixels between them. Whole-line reports in LINE mode map one-to-one
  // onto WTerm mouse-wheel reports.
  const pan = createTuiPan({
    element,
    sendWheel: (lines) => {
      element.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -lines,
          deltaMode: WheelEvent.DOM_DELTA_LINE,
          bubbles: true,
          cancelable: true,
          // TUIs scroll the pane under the pointer: where the swipe began.
          clientX: startX,
          clientY: startY,
        })
      );
    },
  });
  const settlePan = () => pan.settle();

  const applyFingerDelta = (deltaY: number) => {
    // Mouse-aware TUIs receive the same wheel path as desktop input. Managed
    // sessions are attached through tmux, so WTerm sends mouse reports there
    // even if the Ghostty core cannot observe the app's mouse mode through it.
    if (core.usingAltScreen()) {
      pan.move(deltaY);
    } else {
      // A finger moving down reveals older output above the current position.
      element.scrollTop -= deltaY;
    }
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (selectModeRef.current || event.touches.length === 0) return;
    cancelInertia();
    cancelMove();
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    lastY = touch.clientY;
    lastTouchTime = performance.now();
    velocityY = 0;
    gestureActive = true;
    scrollDirection = null;
    const row = element.querySelector<HTMLElement>(
      ".term-row:not(.term-scrollback-row)"
    );
    const measuredRowHeight = row?.getBoundingClientRect().height ?? 0;
    tuiRowHeight =
      Number.isFinite(measuredRowHeight) && measuredRowHeight > 0
        ? measuredRowHeight
        : FALLBACK_ROW_HEIGHT;
    if (core.usingAltScreen()) pan.begin(tuiRowHeight);
    // Do not focus the hidden keyboard textarea here. A swipe is a scroll
    // gesture; tapping still focuses through the normal click handler.
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (selectModeRef.current || !gestureActive || event.touches.length === 0)
      return;

    const touch = event.touches[0];
    if (scrollDirection === null) {
      const deltaX = Math.abs(touch.clientX - startX);
      const deltaY = Math.abs(touch.clientY - startY);
      if (deltaX > 8 || deltaY > 8) {
        scrollDirection = deltaX > deltaY ? "horizontal" : "vertical";
      }
    }
    if (scrollDirection !== "vertical") return;

    event.preventDefault();
    event.stopPropagation();

    const now = performance.now();
    const deltaY = touch.clientY - lastY;
    const elapsed = Math.max(1, now - lastTouchTime);
    lastY = touch.clientY;
    lastTouchTime = now;
    const sampleVelocity = deltaY / elapsed;
    velocityY += (sampleVelocity - velocityY) * TOUCH_VELOCITY_SAMPLE_WEIGHT;
    pendingDeltaY += deltaY;
    if (moveFrame === null) moveFrame = requestAnimationFrame(flushMove);
  };

  const startInertia = () => {
    if (
      scrollDirection !== "vertical" ||
      Math.abs(velocityY) < MIN_INERTIA_VELOCITY
    ) {
      settlePan();
      return;
    }

    let previousFrameTime = 0;
    const animate = (time: number) => {
      if (selectModeRef.current) {
        inertiaFrame = null;
        settlePan();
        return;
      }

      const elapsed =
        previousFrameTime === 0 ? 16 : Math.min(32, time - previousFrameTime);
      previousFrameTime = time;
      const deltaY = velocityY * elapsed;
      if (Math.abs(deltaY) >= 0.1) {
        applyFingerDelta(deltaY);
      }
      velocityY *= Math.exp(-elapsed / TOUCH_INERTIA_DECAY_MS);

      if (Math.abs(velocityY) > MIN_INERTIA_VELOCITY) {
        inertiaFrame = requestAnimationFrame(animate);
      } else {
        inertiaFrame = null;
        velocityY = 0;
        settlePan();
      }
    };

    inertiaFrame = requestAnimationFrame(animate);
  };

  const handleTouchEnd = () => {
    if (!gestureActive) return;
    gestureActive = false;
    if (moveFrame !== null) {
      cancelAnimationFrame(moveFrame);
      flushMove();
    }
    startInertia();
  };

  element.addEventListener("touchstart", handleTouchStart, { passive: true });
  element.addEventListener("touchmove", handleTouchMove, { passive: false });
  element.addEventListener("touchend", handleTouchEnd);
  element.addEventListener("touchcancel", handleTouchEnd);

  return () => {
    cancelInertia();
    cancelMove();
    pan.dispose();
    element.removeEventListener("touchstart", handleTouchStart);
    element.removeEventListener("touchmove", handleTouchMove);
    element.removeEventListener("touchend", handleTouchEnd);
    element.removeEventListener("touchcancel", handleTouchEnd);
    element.style.touchAction = "";
  };
}
