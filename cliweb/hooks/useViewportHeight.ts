"use client";

import { useEffect } from "react";

/**
 * Hook to set CSS custom property for actual viewport height.
 * Handles iOS Safari's virtual keyboard by using visualViewport API.
 *
 * Sets --app-height (and --app-offset-top, how far iOS has panned the
 * visible area down the page) on the document root, updated when:
 * - Window resizes
 * - Visual viewport changes (keyboard appears/disappears)
 * - Orientation changes
 */
export function useViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const setAppHeight = () => {
      // Use visualViewport if available (more accurate on mobile with keyboard).
      const visibleHeight = viewport?.height ?? window.innerHeight;
      if (!Number.isFinite(visibleHeight) || visibleHeight <= 0) return;
      const height = `${Math.round(visibleHeight)}px`;
      const root = document.documentElement.style;
      const heightChanged = root.getPropertyValue("--app-height") !== height;
      if (heightChanged) {
        root.setProperty("--app-height", height);
      }
      // With the keyboard open, iOS pans the visible area down the page to
      // reveal the focused field. The page is fixed, so without following
      // that pan the app's top half slides out of view while typing.
      const offsetTop = `${Math.max(0, Math.round(viewport?.offsetTop ?? 0))}px`;
      if (root.getPropertyValue("--app-offset-top") !== offsetTop) {
        root.setProperty("--app-offset-top", offsetTop);
      }
      // The home-indicator gap belongs below the toolbar only when the
      // keyboard is hidden. iOS shrinks visualViewport while keeping the
      // layout viewport tall; the screen-height check also covers browsers
      // that resize both viewports with an editable field focused.
      const editing =
        document.activeElement?.matches("input, textarea, [contenteditable]") ??
        false;
      const keyboardOpen =
        window.innerWidth < 768 &&
        Math.max(
          window.innerHeight - visibleHeight,
          editing ? screen.height - visibleHeight : 0
        ) > 150;
      document.documentElement.dataset.mobileKeyboard = keyboardOpen
        ? "open"
        : "closed";
      // The terminal must fit the new flex height in this same viewport
      // update. Waiting for its ResizeObserver adds a visible extra frame
      // while the iOS keyboard animates.
      if (heightChanged) {
        window.dispatchEvent(new Event("cliweb:viewport-resize"));
      }
    };

    const scheduleSettledMeasurement = () => {
      setAppHeight();
      if (settleTimer !== null) clearTimeout(settleTimer);
      // Mobile browsers animate the keyboard and may report intermediate
      // viewport sizes. Re-read once the close/open animation has settled.
      settleTimer = setTimeout(() => {
        settleTimer = null;
        setAppHeight();
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
      viewport.addEventListener("scroll", setAppHeight);
    }

    // Handle orientation changes
    if ("orientation" in screen) {
      screen.orientation.addEventListener("change", scheduleSettledMeasurement);
    }

    return () => {
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
        viewport.removeEventListener("scroll", setAppHeight);
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
