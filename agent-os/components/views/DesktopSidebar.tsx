"use client";

import { useRef, useState } from "react";
import { TerminalList } from "@/components/TerminalList";
import { cn } from "@/lib/utils";
import { useSidebarWidth } from "@/hooks/useSidebarWidth";

// Delay before an unpinned, hover-revealed sidebar collapses again
const COLLAPSE_DELAY_MS = 300;

interface DesktopSidebarProps {
  isPinned: boolean;
  onQuickSwitch?: () => void;
  activeTerminalId?: string;
  onSelect: (name: string) => void;
  onNewTerminal: (projectId?: string) => void;
  onCloseTerminal: (projectId: string) => void;
  onStartDevServer: (projectId: string) => void;
  onCreateDevServer: React.ComponentProps<
    typeof TerminalList
  >["onCreateDevServer"];
}

export function DesktopSidebar({
  isPinned,
  onQuickSwitch,
  activeTerminalId,
  onSelect,
  onNewTerminal,
  onCloseTerminal,
  onStartDevServer,
  onCreateDevServer,
}: DesktopSidebarProps) {
  // When unpinned, the sidebar floats and reveals on hover near the left edge
  const [revealed, setRevealed] = useState(false);
  const { width, isResizing, startResize } = useSidebarWidth();
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelCollapse = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  };
  const scheduleCollapse = () => {
    cancelCollapse();
    collapseTimer.current = setTimeout(
      () => setRevealed(false),
      COLLAPSE_DELAY_MS
    );
  };
  const revealNow = () => {
    cancelCollapse();
    setRevealed(true);
  };

  // Drag handle sitting on the sidebar's right edge. It is wider than it
  // looks so it is actually grabbable, but nothing is painted until it is
  // hovered — a permanent line would compete with the material's own edge.
  const resizeHandle = (
    <div
      onMouseDown={startResize}
      role="separator"
      aria-orientation="vertical"
      className={cn(
        "absolute top-0 right-0 z-50 h-full w-1 cursor-col-resize",
        "transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "after:absolute after:inset-y-0 after:-left-1 after:w-3 after:content-['']",
        isResizing ? "bg-primary/60" : "hover:bg-primary/35"
      )}
    />
  );

  const content = (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <TerminalList
          activeTerminalId={activeTerminalId}
          onSelect={onSelect}
          onNewTerminal={onNewTerminal}
          onCloseTerminal={onCloseTerminal}
          onStartDevServer={onStartDevServer}
          onCreateDevServer={onCreateDevServer}
          onQuickSwitch={onQuickSwitch}
        />
      </div>
    </div>
  );

  // A single div carries both states. Switching `isPinned` used to swap in
  // a completely different element (pinned vs floating), which remounted
  // the DOM and skipped the transition entirely. Keeping one element means
  // both the pin-in and pin-out animate through the same `transition-*`
  // classes instead of just snapping.
  return (
    <>
      {/* Hover trigger strip on the left edge reveals the floating sidebar.
          Harmless while pinned since nothing floats to reveal. */}
      {!isPinned && (
        <div
          className="fixed top-0 left-0 z-30 h-full w-2"
          onMouseEnter={revealNow}
        />
      )}
      <div
        onMouseEnter={!isPinned ? revealNow : undefined}
        onMouseLeave={!isPinned ? scheduleCollapse : undefined}
        style={{ width }}
        className={cn(
          "z-20 h-full overflow-hidden",
          "transition-[width,transform] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
          isPinned
            ? [
                "glass glass-edge-right relative flex-shrink-0 translate-x-0",
              ]
            : [
                "glass-thick glass-float fixed top-0 left-0 z-40",
                revealed ? "translate-x-0" : "-translate-x-full",
              ]
        )}
      >
        {content}
        {resizeHandle}
      </div>
    </>
  );
}
