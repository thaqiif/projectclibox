"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  MoreHorizontal,
  Settings,
  Plus,
  Server,
  Trash2,
  Pencil,
  FolderOpen,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Project, DevServer } from "@/lib/db";

interface ProjectCardProps {
  project: Project;
  runningDevServers?: DevServer[];
  onClick?: () => void;
  onToggleExpanded?: (expanded: boolean) => void;
  onEdit?: () => void;
  onNewTerminal?: () => void;
  onStartDevServer?: () => void;
  onOpenInEditor?: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
}

export function ProjectCard({
  project,
  runningDevServers = [],
  onClick,
  onToggleExpanded,
  onEdit,
  onNewTerminal,
  onStartDevServer,
  onOpenInEditor,
  onDelete,
  onRename,
}: ProjectCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Guards against Enter and the follow-up blur both committing. */
  const committedRef = useRef(false);

  const hasRunningServers = runningDevServers.length > 0;
  // Uncategorized can be renamed but not edited, deleted, or given a dev
  // server. New terminal is its own button, not a menu entry.
  const hasActions = project.is_uncategorized
    ? onRename
    : onEdit || onStartDevServer || onDelete || onRename;

  useEffect(() => {
    if (!isEditing) return;
    committedRef.current = false;

    // rAF rather than a timeout race: by the next frame Radix has finished
    // unmounting the menu, so nothing steals focus back off the input.
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [isEditing]);

  const startRename = () => {
    // Always start from the project's current name, so a cancelled edit
    // does not leak into the next one.
    setEditName(project.name);
    setIsEditing(true);
  };

  const commitRename = () => {
    if (committedRef.current) return;
    committedRef.current = true;

    const next = editName.trim();
    if (next && next !== project.name) onRename?.(next);
    setIsEditing(false);
  };

  const cancelRename = () => {
    committedRef.current = true;
    setEditName(project.name);
    setIsEditing(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isEditing) return;
    onClick?.();
    onToggleExpanded?.(!project.expanded);
  };

  const renderMenuItems = (isContextMenu: boolean) => {
    const MenuItem = isContextMenu ? ContextMenuItem : DropdownMenuItem;
    const MenuSeparator = isContextMenu
      ? ContextMenuSeparator
      : DropdownMenuSeparator;

    return (
      <>
        {onEdit && (
          <MenuItem onClick={() => onEdit()}>
            <Settings className="h-4 w-4" />
            Project settings
          </MenuItem>
        )}
        {onRename && (
          <MenuItem onClick={startRename}>
            <Pencil className="h-4 w-4" />
            Rename
          </MenuItem>
        )}
        {onOpenInEditor && (
          <MenuItem onClick={() => onOpenInEditor()}>
            <FolderOpen className="h-4 w-4" />
            Open in editor
          </MenuItem>
        )}
        {onStartDevServer && (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onStartDevServer()}>
              <Server className="h-4 w-4" />
              Start dev server
            </MenuItem>
          </>
        )}
        {onDelete && (
          <>
            <MenuSeparator />
            <MenuItem
              onClick={() => onDelete()}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Delete project
            </MenuItem>
          </>
        )}
      </>
    );
  };

  const cardContent = (
    <div
      onClick={handleClick}
      className={cn(
        "group press-sm relative flex cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 py-2",
        "min-h-[44px] md:min-h-[34px]",
        "transition-colors duration-200 hover:bg-[var(--fill-4)]"
      )}
    >
      {/* Expand/collapse toggle */}
      <button
        aria-hidden
        tabIndex={-1}
        className={cn(
          "text-muted-foreground flex-shrink-0",
          "transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
          project.expanded && "rotate-90"
        )}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>

      {/* Project name + path */}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancelRename();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="ring-primary/50 min-w-0 flex-1 rounded-md bg-[var(--fill-3)] px-1.5 py-0.5 text-[0.8125rem] font-medium outline-none ring-2"
        />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium tracking-[-0.006em]">
              {project.name}
            </span>
          </TooltipTrigger>
          {/* The path is still worth having, just not on screen at all
              times: it is the same prefix on most rows. */}
          <TooltipContent side="right">
            <p className="ui-meta">{project.working_directory}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Running servers indicator */}
      {hasRunningServers && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-label="Dev server running"
              className="bg-status-running/70 h-1.5 w-1.5 flex-shrink-0 rounded-full"
            />
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {runningDevServers.length} dev server
              {runningDevServers.length > 1 ? "s" : ""} running
            </p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Row actions. Both buttons sit in the flow, side by side: the menu
          used to be absolutely positioned against the row's right edge,
          which parked it on top of the new-terminal button. */}
      <div className="flex flex-shrink-0 items-center gap-0.5 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        {onNewTerminal && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New terminal"
                className="h-8 w-8 rounded-full md:h-7 md:w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onNewTerminal();
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>New terminal</p>
            </TooltipContent>
          </Tooltip>
        )}

        {hasActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Project actions"
                className="h-8 w-8 rounded-full md:h-7 md:w-7"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              // Without this Radix returns focus to the trigger on close, which
              // instantly blurs the rename input and cancelled every rename.
              onCloseAutoFocus={(e) => e.preventDefault()}
              onClick={(e) => e.stopPropagation()}
            >
              {renderMenuItems(false)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );

  // Wrap with context menu if actions are available
  if (hasActions) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{cardContent}</ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          {renderMenuItems(true)}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return cardContent;
}
