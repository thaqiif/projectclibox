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

const TOUCH_WHEEL_STEP = 20;
const TOUCH_INERTIA_DECAY_MS = 180;
const MIN_INERTIA_VELOCITY = 0.025;

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
  let scrollAccumulator = 0;
  let inertiaFrame: number | null = null;

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
    scrollAccumulator += fingerDeltaY;
    while (Math.abs(scrollAccumulator) >= TOUCH_WHEEL_STEP) {
      const wheelDelta = scrollAccumulator > 0 ? -100 : 100;
      element.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: wheelDelta,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        })
      );
      scrollAccumulator +=
        scrollAccumulator > 0 ? -TOUCH_WHEEL_STEP : TOUCH_WHEEL_STEP;
    }
  };

  const applyFingerDelta = (
    deltaY: number,
    clientX: number,
    clientY: number
  ) => {
    // Mouse-aware TUIs receive the same wheel path as desktop input. In an
    // alternate screen without mouse mode, WTerm maps that wheel to Up/Down,
    // matching xterm's app-scrolling fallback.
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
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    lastY = touch.clientY;
    lastTouchTime = performance.now();
    velocityY = 0;
    gestureActive = true;
    scrollDirection = null;
    scrollAccumulator = 0;
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
    velocityY = velocityY * 0.65 + (deltaY / elapsed) * 0.35;
    if (Math.abs(deltaY) < 0.1) return;

    applyFingerDelta(deltaY, touch.clientX, touch.clientY);
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
        scrollAccumulator = 0;
      }
    };

    inertiaFrame = requestAnimationFrame(animate);
  };

  const handleTouchEnd = () => {
    if (!gestureActive) return;
    gestureActive = false;
    startInertia();
  };

  element.addEventListener("touchstart", handleTouchStart, { passive: true });
  element.addEventListener("touchmove", handleTouchMove, { passive: false });
  element.addEventListener("touchend", handleTouchEnd);
  element.addEventListener("touchcancel", handleTouchEnd);

  return () => {
    cancelInertia();
    element.removeEventListener("touchstart", handleTouchStart);
    element.removeEventListener("touchmove", handleTouchMove);
    element.removeEventListener("touchend", handleTouchEnd);
    element.removeEventListener("touchcancel", handleTouchEnd);
    element.style.touchAction = "";
  };
}
