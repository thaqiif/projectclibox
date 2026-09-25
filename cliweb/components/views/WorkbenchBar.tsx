"use client";

import {
  FolderOpen,
  SquareTerminal,
} from "lucide-react";
import { usePanes } from "@/contexts/PaneContext";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ViewMode } from "@/lib/panes";

/**
 * The workbench's view controls, hoisted out of the terminal.
 *
 * These used to be a strip on every pane's tab bar. There is one terminal
 * now, so they belong to the workbench, not to a pane.
 *
 * What the main surface *is* — terminal or files — is a segmented control,
 * one choice out of a set, with a selection that slides between the options.
 */

const SEGMENTS: { mode: ViewMode; label: string; icon: LucideIcon }[] = [
  { mode: "terminal", label: "Terminal", icon: SquareTerminal },
  { mode: "files", label: "Files", icon: FolderOpen },
];

function Segment({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "press-sm focus-ring relative z-10 flex h-7 w-full items-center justify-center gap-1.5 rounded-sm px-3",
        "text-[0.75rem] font-medium transition-colors duration-100",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export function WorkbenchBar() {
  const {
    attachedTmux,
    viewMode,
    setViewMode,
  } = usePanes();

  // Nothing attached means the welcome screen is up: there is no terminal
  // to split and no working directory for files to point at.
  if (!attachedTmux) return null;

  const selectedIndex = Math.max(
    0,
    SEGMENTS.findIndex((s) => s.mode === viewMode)
  );

  return (
    <div className="flex items-center gap-2">
      {/* Segmented control. The selection is one element that slides, so the
          move reads as the same object travelling rather than two states
          swapping — and it inherits the track's rounding. */}
      <div
        role="tablist"
        className="relative grid grid-cols-2 items-center rounded-sm border border-[var(--shell-line)] bg-[var(--shell-hover)] p-0.5"
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-0.5 bottom-0.5 left-0.5 rounded-[2px] bg-[var(--shell-selected)]",
            "transition-transform duration-150 ease-out"
          )}
          style={{
            width: `calc((100% - 0.25rem) / ${SEGMENTS.length})`,
            transform: `translateX(${selectedIndex * 100}%)`,
          }}
        />
        {SEGMENTS.map((segment) => (
          <Segment
            key={segment.mode}
            label={segment.label}
            icon={segment.icon}
            active={viewMode === segment.mode}
            onClick={() => setViewMode(segment.mode)}
          />
        ))}
      </div>
    </div>
  );
}
