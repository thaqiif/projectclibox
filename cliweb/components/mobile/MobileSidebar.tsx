"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  prefersReducedMotion,
  spring,
  SPRING,
  type SpringHandle,
} from "@/lib/spring";

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The mobile sidebar — a drawer that slides in from the left edge.
 *
 * It used to be draggable as well: the panel tracked the finger one-to-one,
 * resisted past its open edge and sprang to wherever a flick was heading.
 * That made the drawer a second thing on the screen that moves under a finger,
 * competing with the one gesture the workbench does want — scrolling the
 * terminal. The drawer now opens from the header button and closes from the
 * scrim, and the terminal is the only surface that responds to a swipe.
 */
export function MobileSidebar({
  isOpen,
  onClose,
  children,
}: MobileSidebarProps) {
  const panelRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const springRef = useRef<SpringHandle | null>(null);
  const springTargetRef = useRef<number | null>(null);
  const springActiveRef = useRef(false);

  const widthRef = useRef(280);
  const xRef = useRef(-280);

  /** Paint a position. The scrim's opacity is the slide's progress, so the
      dimming travels with the panel instead of snapping at the end. */
  const paint = useCallback((x: number) => {
    xRef.current = x;
    const width = widthRef.current;
    if (panelRef.current) {
      panelRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
    }
    if (scrimRef.current) {
      const progress = Math.min(1, Math.max(0, 1 + x / width));
      scrimRef.current.style.opacity = String(progress);
      scrimRef.current.style.pointerEvents = progress > 0.02 ? "auto" : "none";
    }
  }, []);

  const springTo = useCallback(
    (target: number) => {
      // Already springing toward this target — restarting would throw away the
      // animation's momentum for no reason.
      if (springActiveRef.current && springTargetRef.current === target) {
        return;
      }
      springTargetRef.current = target;
      if (prefersReducedMotion()) {
        springRef.current?.stop();
        springActiveRef.current = false;
        paint(target);
        return;
      }
      if (springRef.current) springRef.current.stop();
      springActiveRef.current = true;
      springRef.current = spring(
        xRef.current,
        target,
        paint,
        SPRING.sheet,
        () => {
          springRef.current = null;
          springActiveRef.current = false;
        }
      );
    },
    [paint]
  );

  // Measure once mounted so the closed position is the real panel width rather
  // than the 280px guess.
  useEffect(() => {
    const measure = () => {
      const w = panelRef.current?.offsetWidth;
      if (w) widthRef.current = w;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Follow the controlled state. Springs from wherever the panel currently is,
  // so toggling mid-animation reverses cleanly.
  useEffect(() => {
    springTo(isOpen ? 0 : -widthRef.current);
  }, [isOpen, springTo]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => () => springRef.current?.stop(), []);

  return (
    <>
      {/* The scrim blurs as well as dims, so the workbench recedes behind the
          drawer rather than merely going dark. */}
      <div
        ref={scrimRef}
        aria-hidden={!isOpen}
        style={{ opacity: 0, pointerEvents: "none" }}
        className="fixed inset-0 z-40 bg-black/45 md:hidden"
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        ref={panelRef}
        style={{ transform: "translate3d(-280px, 0, 0)" }}
        className={cn(
          "glass-thick glass-float fixed top-0 bottom-0 left-0 z-50 w-[280px] md:hidden",
          "flex flex-col will-change-transform"
        )}
      >
        {/* Safe area spacer (status bar / notch) */}
        <div className="h-[env(safe-area-inset-top)]" />

        {/* Content */}
        <div className="scrollbar-thin flex-1 overflow-y-auto">{children}</div>

        {/* Safe area spacer */}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </aside>
    </>
  );
}
