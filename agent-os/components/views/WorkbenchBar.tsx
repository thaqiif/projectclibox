"use client";

import {
  Columns2,
  FolderOpen,
  GitBranch,
  Rows2,
  SquareTerminal,
  Terminal,
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
 * now, so they belong to the workbench, not to a pane — and the splits go
 * to tmux, which means they outlive the page.
 *
 * Two different kinds of control live here and now look like it. What the
 * main surface *is* — terminal or files — is a segmented control, one choice
 * out of a set, with a selection that slides between the options. Git and
 * the shell are drawers that toggle independently, so they are separate
 * buttons rather than a fifth and sixth segment.
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
        "press-sm focus-ring relative z-10 flex h-7 w-full items-center justify-center gap-1.5 rounded-full px-3",
        "text-[0.75rem] font-medium transition-colors duration-200",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function DrawerToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={active}
          aria-label={label}
          onClick={onClick}
          className={cn(
            "press focus-ring flex h-8 w-8 items-center justify-center rounded-full",
            "transition-colors duration-200",
            active
              ? "bg-primary/14 text-primary"
              : "text-muted-foreground hover:bg-[var(--fill-4)] hover:text-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function SplitControl({
  icon: Icon,
  tooltip,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  tooltip: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={tooltip}
          className={cn(
            "press focus-ring text-muted-foreground hover:text-foreground",
            "flex h-8 w-8 items-center justify-center rounded-full",
            "transition-colors duration-200 hover:bg-[var(--fill-4)]",
            "disabled:pointer-events-none disabled:opacity-30"
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function WorkbenchBar() {
  const {
    attachedTmux,
    viewMode,
    gitDrawerOpen,
    shellDrawerOpen,
    setViewMode,
    toggleGitDrawer,
    toggleShellDrawer,
    splitPane,
  } = usePanes();

  // Nothing attached means the welcome screen is up: there is no terminal
  // to split and no working directory for files or git to point at.
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
        className="relative grid grid-cols-2 items-center rounded-full bg-[var(--fill-4)] p-0.5"
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-0.5 bottom-0.5 left-0.5 rounded-full bg-[var(--fill-1)]",
            "shadow-[var(--elev-1)]",
            "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
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

      <div className="flex items-center gap-0.5">
        <DrawerToggle
          icon={GitBranch}
          label="Git"
          active={gitDrawerOpen}
          onClick={toggleGitDrawer}
        />
        <DrawerToggle
          icon={Terminal}
          label="Shell"
          active={shellDrawerOpen}
          onClick={toggleShellDrawer}
        />
      </div>

      {/* Splits are tmux splits: they persist across a refresh, and are
          only meaningful once the terminal is attached. */}
      <div className="flex items-center gap-0.5">
        <SplitControl
          icon={Columns2}
          tooltip="Split horizontal"
          disabled={!attachedTmux}
          onClick={() => splitPane("horizontal")}
        />
        <SplitControl
          icon={Rows2}
          tooltip="Split vertical"
          disabled={!attachedTmux}
          onClick={() => splitPane("vertical")}
        />
      </div>
    </div>
  );
}
