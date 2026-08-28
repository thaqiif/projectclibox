"use client";

import { useState, useEffect } from "react";

/**
 * Mobile-first viewport detection hook
 * Breakpoint: 768px (md in Tailwind)
 */
export function useViewport() {
  const [isMobile, setIsMobile] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const checkViewport = () => {
      setIsMobile(window.innerWidth < 768);
    };

    // Initial check after mount, so the browser-only measurement does not
    // cascade another render from inside the effect body.
    const frame = requestAnimationFrame(() => {
      checkViewport();
      setIsHydrated(true);
    });

    // Listen for resize
    window.addEventListener("resize", checkViewport);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", checkViewport);
    };
  }, []);

  return {
    isMobile,
    isDesktop: !isMobile,
    isHydrated, // For avoiding hydration mismatches
  };
}
