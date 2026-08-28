"use client";

import { useState, useCallback, useEffect, useRef } from "react";

const STORAGE_KEY = "agentOS-sidebar-width";

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 560;
export const SIDEBAR_DEFAULT_WIDTH = 240;

function clamp(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

/**
 * Draggable sidebar width, persisted per browser.
 *
 * The sidebar was a fixed w-60, which is too narrow for deep project trees
 * and too wide on a small screen. Width is clamped so it can never be
 * dragged to nothing or over the whole workbench.
 */
export function useSidebarWidth() {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const frame = useRef<number | null>(null);
  // The drag's end handler needs the final width, and a setState updater is
  // the wrong place to persist it: React may run an updater more than once.
  const latest = useRef(SIDEBAR_DEFAULT_WIDTH);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) {
      latest.current = clamp(stored);
      setWidth(latest.current);
    }
  }, []);

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setIsResizing(true);

    const onMove = (e: MouseEvent) => {
      // One update per frame: a raw mousemove handler re-renders the whole
      // terminal list far more often than the screen can show it.
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        latest.current = clamp(e.clientX);
        setWidth(latest.current);
      });
    };

    const onUp = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      setIsResizing(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // Restore the text selection and cursor the drag suppressed.
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      localStorage.setItem(STORAGE_KEY, String(latest.current));
    };

    // Without these the drag selects the sidebar's text and the cursor
    // flickers between col-resize and the default as it leaves the handle.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return { width, isResizing, startResize };
}
