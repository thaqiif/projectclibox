"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Columns3,
  Menu,
  Terminal as TerminalIcon,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/db";
import type { TerminalRecord } from "@/lib/terminals";
import type { LucideIcon } from "lucide-react";
import { useTerminalRename } from "@/hooks/useTerminalRename";

import type { ViewMode } from "@/lib/panes";

interface ViewModeButtonProps {
  mode: ViewMode;
  currentMode: ViewMode;
  icon: LucideIcon;
  label: string;
  onClick: (mode: ViewMode) => void;
  badge?: React.ReactNode;
}

function ViewModeButton({
  mode,
  currentMode,
  icon: Icon,
  label,
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
      aria-label={label}
      title={label}
      className={cn(
        "press-sm focus-ring flex h-9 w-9 items-center justify-center rounded-sm transition-colors",
        badge && "gap-1 px-2.5",
        currentMode === mode
          ? "text-foreground bg-[var(--shell-selected)]"
          : "text-muted-foreground hover:text-foreground hover:bg-[var(--shell-hover)]"
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
        className="ring-primary/50 h-9 min-w-0 flex-1 rounded-sm bg-[var(--fill-3)] px-3 text-[0.8125rem] font-medium ring-2 outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onDoubleClick={startEditing}
      title="Double-click to rename"
      className="press focus-ring flex h-9 min-w-0 flex-1 flex-col justify-center rounded-sm px-2 text-left transition-colors hover:bg-[var(--shell-hover)]"
    >
      <span className="block w-full truncate text-[0.8125rem] leading-4 font-medium tracking-[-0.006em]">
        {name}
      </span>
      <span className="text-muted-foreground block w-full truncate text-[0.625rem] leading-3">
        {projectName || "Uncategorized"}
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
  onMonitorToggle?: () => void;
  monitorAvailable: boolean;
}

export function MobileTabBar({
  terminal,
  projects,
  viewMode,
  onMenuClick,
  onViewModeChange,
  onMonitorToggle,
  monitorAvailable,
}: MobileTabBarProps) {
  const renameTerminal = useTerminalRename();

  // Get project name for current terminal
  const projectName = terminal?.project_id
    ? projects.find((p) => p.id === terminal.project_id)?.name
    : null;

  return (
    <div
      className="mobile-top-bar glass-edge-bottom relative z-10 flex items-center gap-1 px-2 pb-2"
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
          className="h-9 w-9 shrink-0 rounded-sm"
        >
          <Menu className="h-[1.125rem] w-[1.125rem]" />
        </Button>
      )}

      {/* Current terminal's name, renamable in place */}
      <div className="ml-1 flex min-w-0 flex-1 items-center gap-1 border-l border-[var(--shell-line)] pl-1">
        {terminal ? (
          <MobileTerminalTitle
            name={terminal.name}
            projectName={projectName}
            onRename={renameTerminal}
          />
        ) : (
          <span className="text-muted-foreground flex h-9 min-w-0 flex-1 items-center px-2 text-[0.8125rem] font-medium">
            No terminal
          </span>
        )}
      </div>

      {/* View mode toggle */}
      {terminal?.working_directory && (
        <div
          role="group"
          aria-label="View"
          className="flex shrink-0 items-center gap-0.5 rounded-sm border border-[var(--shell-line)] bg-[var(--shell-hover)] p-0.5"
        >
          <ViewModeButton
            mode="terminal"
            currentMode={viewMode}
            icon={TerminalIcon}
            label="Terminal view"
            onClick={onViewModeChange}
          />
          <ViewModeButton
            mode="files"
            currentMode={viewMode}
            icon={FolderOpen}
            label="Files view"
            onClick={onViewModeChange}
          />
        </div>
      )}

      {onMonitorToggle && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open monitor workspace"
          title="Monitor"
          aria-pressed={false}
          disabled={!monitorAvailable}
          onClick={(e) => {
            e.stopPropagation();
            onMonitorToggle();
          }}
          className="h-9 w-9 shrink-0 rounded-sm"
        >
          <Columns3 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
