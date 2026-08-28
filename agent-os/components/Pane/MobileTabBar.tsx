"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Menu,
  Terminal as TerminalIcon,
  FolderOpen,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/db";
import type { TerminalRecord } from "@/lib/terminals";
import type { LucideIcon } from "lucide-react";
import { useTerminalRename } from "@/hooks/useTerminalRename";

import type { ViewMode } from "@/lib/panes";

/** Segment order, so the sliding selection knows where to sit. */
const VIEW_MODE_ORDER: ViewMode[] = ["terminal", "files", "git"];

interface ViewModeButtonProps {
  mode: ViewMode;
  currentMode: ViewMode;
  icon: LucideIcon;
  onClick: (mode: ViewMode) => void;
  badge?: React.ReactNode;
}

function ViewModeButton({
  mode,
  currentMode,
  icon: Icon,
  onClick,
  badge,
}: ViewModeButtonProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(mode);
      }}
      aria-pressed={currentMode === mode}
      className={cn(
        "press-sm focus-ring relative z-10 flex h-8 min-w-11 items-center justify-center rounded-full",
        "transition-colors duration-200",
        badge && "gap-1 px-2.5",
        currentMode === mode ? "text-foreground" : "text-muted-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {badge && <span className="text-[0.625rem] tabular-nums">{badge}</span>}
    </button>
  );
}

interface MobileTerminalTitleProps {
  name: string;
  projectName?: string | null;
  onRename: (name: string, newName: string) => void | Promise<void>;
}

/**
 * The current terminal's name, renamable in place with a double-click.
 *
 * Styled like the dropdown trigger it replaced, so removing the tab
 * switcher didn't leave a hole in the bar's rhythm.
 */
function MobileTerminalTitle({
  name,
  projectName,
  onRename,
}: MobileTerminalTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Guards against Enter and the follow-up blur both committing. */
  const committedRef = useRef(false);

  useEffect(() => {
    if (!isEditing) return;
    committedRef.current = false;

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [isEditing, name]);

  const startEditing = () => {
    setDraft(name);
    setIsEditing(true);
  };

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;

    const next = draft.trim();
    if (next && next !== name) void onRename(name, next);
    setIsEditing(false);
  };

  const cancel = () => {
    committedRef.current = true;
    setDraft(name);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className="ring-primary/50 h-9 min-w-0 flex-1 rounded-full bg-[var(--fill-3)] px-3 text-[0.8125rem] font-medium outline-none ring-2"
      />
    );
  }

  return (
    <button
      type="button"
      onDoubleClick={startEditing}
      title="Double-click to rename"
      className="press focus-ring flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-3 transition-colors hover:bg-[var(--fill-4)]"
    >
      <span className="truncate text-[0.8125rem] font-medium tracking-[-0.006em]">
        {name}
        {projectName && projectName !== "Uncategorized" && (
          <span className="text-muted-foreground font-normal">
            {" · "}
            {projectName}
          </span>
        )}
      </span>
    </button>
  );
}

interface MobileTabBarProps {
  terminal: TerminalRecord | null | undefined;
  projects: Project[];
  viewMode: ViewMode;
  onMenuClick?: () => void;
  onViewModeChange: (mode: ViewMode) => void;
}

export function MobileTabBar({
  terminal,
  projects,
  viewMode,
  onMenuClick,
  onViewModeChange,
}: MobileTabBarProps) {
  const renameTerminal = useTerminalRename();

  // Get project name for current terminal
  const projectName = terminal?.project_id
    ? projects.find((p) => p.id === terminal.project_id)?.name
    : null;

  return (
    <div
      className="glass glass-edge-bottom relative z-10 flex items-center gap-1.5 px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]"
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      {/* Menu button */}
      {onMenuClick && (
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onMenuClick();
          }}
          aria-label="Open sidebar"
          className="h-9 w-9 shrink-0 rounded-full"
        >
          <Menu className="h-[1.125rem] w-[1.125rem]" />
        </Button>
      )}

      {/* Current terminal's name, renamable in place */}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {terminal ? (
          <MobileTerminalTitle
            name={terminal.name}
            projectName={projectName}
            onRename={renameTerminal}
          />
        ) : (
          <span className="text-muted-foreground flex h-9 min-w-0 flex-1 items-center justify-center px-3 text-[0.8125rem] font-medium">
            No terminal
          </span>
        )}
      </div>

      {/* View mode toggle */}
      {terminal?.working_directory && (
        <div
          role="tablist"
          className="relative flex shrink-0 items-center rounded-full bg-[var(--fill-4)] p-0.5"
        >
          {/* The selection is one pill that travels, not three states that
              blink — same object, new place. */}
          <span
            aria-hidden="true"
            className="absolute top-0.5 bottom-0.5 left-0.5 w-11 rounded-full bg-[var(--fill-1)] shadow-[var(--elev-1)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
            style={{
              transform: `translateX(${VIEW_MODE_ORDER.indexOf(viewMode) * 100}%)`,
            }}
          />
          <ViewModeButton
            mode="terminal"
            currentMode={viewMode}
            icon={TerminalIcon}
            onClick={onViewModeChange}
          />
          <ViewModeButton
            mode="files"
            currentMode={viewMode}
            icon={FolderOpen}
            onClick={onViewModeChange}
          />
          <ViewModeButton
            mode="git"
            currentMode={viewMode}
            icon={GitBranch}
            onClick={onViewModeChange}
          />
        </div>
      )}
    </div>
  );
}
