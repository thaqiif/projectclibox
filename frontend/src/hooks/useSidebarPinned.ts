"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "cliweb-sidebar-pinned";

/**
 * Hook to manage desktop sidebar pin state with localStorage persistence.
 * Pinned (default): sidebar is docked and pushes content.
 * Unpinned: sidebar collapses to give the main pane more room and
 * reveals on hover near the left edge.
 */
export function useSidebarPinned() {
  const [isPinned, setIsPinned] = useState(true);

  // Load persisted state on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "false") {
      const frame = requestAnimationFrame(() => setIsPinned(false));
      return () => cancelAnimationFrame(frame);
    }
  }, []);

  const setPinned = useCallback((pinned: boolean) => {
    setIsPinned(pinned);
    localStorage.setItem(STORAGE_KEY, String(pinned));
  }, []);

  const togglePin = useCallback(() => {
    setIsPinned((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  /**
   * Cmd/Ctrl+B, as in VS Code. Direct PTYs have no terminal multiplexer
   * prefix to reserve, so the shortcut is consistent everywhere.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "b" && event.key !== "B") return;
      if (event.altKey) return;

      const isCmd = event.metaKey && !event.ctrlKey;
      const isCtrl = event.ctrlKey && !event.metaKey;
      if (!isCmd && !isCtrl) return;

      event.preventDefault();
      togglePin();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePin]);

  return { isPinned, togglePin, setPinned };
}
