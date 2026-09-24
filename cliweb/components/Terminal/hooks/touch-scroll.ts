"use client";

import type { RefObject } from "react";
import type { WTerm } from "@wterm/dom";
import type { GhosttyCore } from "@wterm/ghostty";

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
  let pendingX = 0;
  let pendingY = 0;
  let moveFrame: number | null = null;

  // Touch events can arrive faster than the display refreshes. Batch them so
  // each frame does one scroll/wheel dispatch instead of several reflows.
  const flushMove = () => {
    moveFrame = null;
    const deltaY = pendingDeltaY;
    pendingDeltaY = 0;
    if (Math.abs(deltaY) >= 0.1) applyFingerDelta(deltaY, pendingX, pendingY);
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

  const dispatchTuiWheel = (
    fingerDeltaY: number,
    clientX: number,
    clientY: number
  ) => {
    // Model the finger movement as fractional terminal rows. WTerm carries
    // the fractional part between events and emits one mouse-wheel report per
    // completed row, instead of turning each small touch movement into a
    // burst of full-strength wheel events.
    element.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -fingerDeltaY / tuiRowHeight,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      })
    );
  };

  const applyFingerDelta = (
    deltaY: number,
    clientX: number,
    clientY: number
  ) => {
    // Mouse-aware TUIs receive the same wheel path as desktop input. Managed
    // sessions are attached through tmux, so WTerm sends mouse reports there
    // even if the Ghostty core cannot observe the app's mouse mode through it.
    if (core.usingAltScreen()) {
      dispatchTuiWheel(deltaY, clientX, clientY);
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
    pendingX = touch.clientX;
    pendingY = touch.clientY;
    if (moveFrame === null) moveFrame = requestAnimationFrame(flushMove);
  };

  const startInertia = () => {
    if (
      scrollDirection !== "vertical" ||
      Math.abs(velocityY) < MIN_INERTIA_VELOCITY
    ) {
      return;
    }

    let previousFrameTime = 0;
    const animate = (time: number) => {
      if (selectModeRef.current) {
        inertiaFrame = null;
        return;
      }

      const elapsed =
        previousFrameTime === 0 ? 16 : Math.min(32, time - previousFrameTime);
      previousFrameTime = time;
      const deltaY = velocityY * elapsed;
      if (Math.abs(deltaY) >= 0.1) {
        applyFingerDelta(deltaY, startX, lastY);
      }
      velocityY *= Math.exp(-elapsed / TOUCH_INERTIA_DECAY_MS);

      if (Math.abs(velocityY) > MIN_INERTIA_VELOCITY) {
        inertiaFrame = requestAnimationFrame(animate);
      } else {
        inertiaFrame = null;
        velocityY = 0;
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
    element.removeEventListener("touchstart", handleTouchStart);
    element.removeEventListener("touchmove", handleTouchMove);
    element.removeEventListener("touchend", handleTouchEnd);
    element.removeEventListener("touchcancel", handleTouchEnd);
    element.style.touchAction = "";
  };
}
