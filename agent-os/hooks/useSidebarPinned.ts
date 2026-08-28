"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "agentOS-sidebar-pinned";

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
   * Cmd/Ctrl+B, as in VS Code.
   *
   * Ctrl+B is also tmux's prefix key, and this whole app is a window onto
   * tmux. So Ctrl+B is only claimed when focus is outside the terminal —
   * inside it, the keystroke belongs to tmux and is left alone. Cmd+B has
   * no such conflict and always toggles.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "b" && event.key !== "B") return;
      if (event.altKey) return;

      const isCmd = event.metaKey && !event.ctrlKey;
      const isCtrl = event.ctrlKey && !event.metaKey;
      if (!isCmd && !isCtrl) return;

      if (isCtrl) {
        const target = event.target as Element | null;
        if (target?.closest?.(".xterm")) return;
      }

      event.preventDefault();
      togglePin();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePin]);

  return { isPinned, togglePin, setPinned };
}
