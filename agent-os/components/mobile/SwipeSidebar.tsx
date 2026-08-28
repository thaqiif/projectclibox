"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  prefersReducedMotion,
  projectMomentum,
  rubberBand,
  spring,
  SPRING,
  VelocityTracker,
  type SpringHandle,
} from "@/lib/spring";

interface SwipeSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Movement, in px, before a touch commits to being a drag rather than a tap. */
const DRAG_THRESHOLD = 10;
/** A flick this fast dismisses regardless of how far it travelled. */
const FLICK_VELOCITY = 380; // px/s

/**
 * The mobile sidebar — a drawer you can actually grab.
 *
 * The panel tracks the finger one-to-one while it is down, resists past its
 * open edge instead of hard-stopping, and on release springs to wherever the
 * gesture was *going* rather than where it happened to end. Because the
 * spring always starts from the live on-screen value, a reversal mid-flight
 * is picked up instead of fought — which is the whole difference between a
 * drawer that feels like an object and one that feels like two states.
 */
export function SwipeSidebar({ isOpen, onClose, children }: SwipeSidebarProps) {
  const panelRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const springRef = useRef<SpringHandle | null>(null);
  const springTargetRef = useRef<number | null>(null);
  const springActiveRef = useRef(false);

  const widthRef = useRef(280);
  const xRef = useRef(-280);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startPanelX: number;
    committed: boolean;
  } | null>(null);
  const tracker = useRef(new VelocityTracker());

  /** Paint a position. The scrim's opacity is the drag's progress, so the
      dimming follows the finger instead of snapping at the end. */
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
    (target: number, velocity = 0) => {
      // Already springing toward this target (e.g. a gesture release just
      // started it) — the controlled-state effect re-fires right after via
      // onClose(), and restarting here would drop the flick's momentum.
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
      if (springRef.current) {
        springRef.current.stop();
      }
      springActiveRef.current = true;
      springRef.current = spring(
        xRef.current,
        target,
        paint,
        { ...SPRING.sheet, velocity },
        () => {
          springRef.current = null;
          springActiveRef.current = false;
        }
      );
    },
    [paint]
  );

  // Measure once mounted so the closed position is the real panel width
  // rather than the 280px guess.
  useEffect(() => {
    const measure = () => {
      const w = panelRef.current?.offsetWidth;
      if (w) widthRef.current = w;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Follow the controlled state. Springs from wherever the panel currently
  // is, so toggling mid-animation reverses cleanly.
  useEffect(() => {
    springTo(isOpen ? 0 : -widthRef.current);
  }, [isOpen, springTo]);

  // Direct manipulation. Pointer events (not touch) so a capture keeps the
  // moves coming even when the finger leaves the panel.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!isOpen || e.pointerType === "mouse") return;
      springRef.current?.stop();
      springActiveRef.current = false;
      tracker.current.reset();
      tracker.current.add(xRef.current);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startPanelX: xRef.current,
        committed: false,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      const dx = e.clientX - drag.startX;
      if (!drag.committed) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        drag.committed = true;
        panel.setPointerCapture(e.pointerId);
      }

      let next = drag.startPanelX + dx;
      // Past the open edge the panel resists progressively rather than
      // stopping dead — you can pull, but it pulls back.
      if (next > 0) next = rubberBand(next, widthRef.current);
      tracker.current.add(next);
      paint(next);
    };

    const onPointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      if (!drag.committed) return;

      const velocity = tracker.current.velocity;
      // Land where the flick was heading, not where the finger lifted.
      const landing = xRef.current + projectMomentum(velocity, 0.99);
      const width = widthRef.current;

      const shouldClose =
        velocity < -FLICK_VELOCITY ||
        (velocity < FLICK_VELOCITY && landing < -width / 2);

      if (shouldClose) {
        springTo(-width, velocity);
        onClose();
      } else {
        springTo(0, velocity);
      }
    };

    panel.addEventListener("pointerdown", onPointerDown, { passive: true });
    panel.addEventListener("pointermove", onPointerMove, { passive: true });
    panel.addEventListener("pointerup", onPointerUp);
    panel.addEventListener("pointercancel", onPointerUp);
    return () => {
      panel.removeEventListener("pointerdown", onPointerDown);
      panel.removeEventListener("pointermove", onPointerMove);
      panel.removeEventListener("pointerup", onPointerUp);
      panel.removeEventListener("pointercancel", onPointerUp);
    };
  }, [isOpen, onClose, paint, springTo]);

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
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[3px] md:hidden"
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        ref={panelRef}
        style={{ transform: "translate3d(-280px, 0, 0)" }}
        className={cn(
          "glass-thick glass-float fixed top-0 bottom-0 left-0 z-50 w-[280px] md:hidden",
          "flex touch-pan-y flex-col will-change-transform"
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
