"use client";

import { useEffect } from "react";

/**
 * Hook to set CSS custom property for actual viewport height.
 * Handles iOS Safari's virtual keyboard by using visualViewport API.
 *
 * Sets --app-height CSS variable on document root that updates when:
 * - Window resizes
 * - Visual viewport changes (keyboard appears/disappears)
 * - Orientation changes
 */
export function useViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const setAppHeight = () => {
      frame = null;
      // Use visualViewport if available (more accurate on mobile with keyboard).
      const visibleHeight = viewport?.height ?? window.innerHeight;
      if (!Number.isFinite(visibleHeight) || visibleHeight <= 0) return;
      const height = `${Math.round(visibleHeight)}px`;
      if (
        document.documentElement.style.getPropertyValue("--app-height") !==
        height
      ) {
        document.documentElement.style.setProperty("--app-height", height);
      }
    };

    const scheduleMeasurement = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(setAppHeight);
    };

    const scheduleSettledMeasurement = () => {
      scheduleMeasurement();
      if (settleTimer !== null) clearTimeout(settleTimer);
      // Mobile browsers animate the keyboard and may report intermediate
      // viewport sizes. Re-read once the close/open animation has settled.
      settleTimer = setTimeout(() => {
        settleTimer = null;
        scheduleMeasurement();
      }, 260);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleSettledMeasurement();
      }
    };

    // Set an accurate value before listening for future viewport changes.
    setAppHeight();

    window.addEventListener("resize", scheduleSettledMeasurement);
    window.addEventListener("pageshow", scheduleSettledMeasurement);
    document.addEventListener("focusout", scheduleSettledMeasurement, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Visual viewport resize handles keyboard appearance on mobile. Scroll
    // can also change its visible height in browsers that pan the viewport.
    if (viewport) {
      viewport.addEventListener("resize", scheduleSettledMeasurement);
      viewport.addEventListener("scroll", scheduleMeasurement);
    }

    // Handle orientation changes
    if ("orientation" in screen) {
      screen.orientation.addEventListener("change", scheduleSettledMeasurement);
    }

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (settleTimer !== null) clearTimeout(settleTimer);
      window.removeEventListener("resize", scheduleSettledMeasurement);
      window.removeEventListener("pageshow", scheduleSettledMeasurement);
      document.removeEventListener(
        "focusout",
        scheduleSettledMeasurement,
        true
      );
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (viewport) {
        viewport.removeEventListener("resize", scheduleSettledMeasurement);
        viewport.removeEventListener("scroll", scheduleMeasurement);
      }
      if ("orientation" in screen) {
        screen.orientation.removeEventListener(
          "change",
          scheduleSettledMeasurement
        );
      }
    };
  }, []);
}
