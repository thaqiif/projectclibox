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

export function setupTouchScroll(config: TouchScrollConfig): () => void {
  const { terminal, core, selectModeRef, isMobile } = config;
  if (!isMobile) return () => {};

  const element = terminal.element;
  element.style.touchAction = "none";

  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let scrollDirection: "vertical" | "horizontal" | null = null;
  let scrollAccumulator = 0;

  const handleTouchStart = (event: TouchEvent) => {
    if (selectModeRef.current || event.touches.length === 0) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    lastY = touch.clientY;
    scrollDirection = null;
    scrollAccumulator = 0;
    terminal.focus();
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (selectModeRef.current || event.touches.length === 0) return;
    if (scrollDirection === null && startX === 0 && startY === 0) return;

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
    const deltaY = touch.clientY - lastY;
    lastY = touch.clientY;
    if (Math.abs(deltaY) < 1) return;

    if (core.usingAltScreen() && core.mouseTracking() !== 0 && core.mouseSgr()) {
      scrollAccumulator += deltaY;
      while (Math.abs(scrollAccumulator) >= 20) {
        const wheelDelta = scrollAccumulator > 0 ? -100 : 100;
        element.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: wheelDelta,
            deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            bubbles: true,
            cancelable: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
          })
        );
        scrollAccumulator += scrollAccumulator > 0 ? -20 : 20;
      }
    } else {
      // A finger moving down reveals older output above the current position.
      element.scrollTop -= deltaY;
    }
  };

  const reset = () => {
    startX = 0;
    startY = 0;
    lastY = 0;
    scrollDirection = null;
    scrollAccumulator = 0;
  };

  element.addEventListener("touchstart", handleTouchStart, { passive: true });
  element.addEventListener("touchmove", handleTouchMove, { passive: false });
  element.addEventListener("touchend", reset);
  element.addEventListener("touchcancel", reset);

  return () => {
    element.removeEventListener("touchstart", handleTouchStart);
    element.removeEventListener("touchmove", handleTouchMove);
    element.removeEventListener("touchend", reset);
    element.removeEventListener("touchcancel", reset);
    element.style.touchAction = "";
  };
}
