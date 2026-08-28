"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  GitFork,
  GitBranch,
  GitPullRequest,
  Check,
  Loader2,
  MoreHorizontal,
  FolderInput,
  Trash2,
  Copy,
  Pencil,
  Sparkles,
  Square,
  CheckSquare,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { TerminalRecord } from "@/lib/terminals";

export interface TerminalCardProps {
  terminal: TerminalRecord;
  isActive?: boolean;
  // Selection props
  isSelected?: boolean;
  isInSelectMode?: boolean;
  onToggleSelect?: (shiftKey: boolean) => void;
  // Navigation
  onClick?: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  onHoverStart?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
}

export function TerminalCard({
  terminal,
  isActive,
  isSelected,
  isInSelectMode,
  onToggleSelect,
  onClick,
  onDelete,
  onRename,
  onHoverStart,
  onHoverEnd,
}: TerminalCardProps) {
  // tmux reports last activity in seconds since the epoch.
  const timeAgo = getTimeAgo(terminal.activity);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(terminal.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const justStartedEditingRef = useRef(false);

  const handleMouseEnter = () => {
    if (!onHoverStart || !cardRef.current || menuOpen) return;
    // Debounce hover to avoid flickering
    hoverTimeoutRef.current = setTimeout(() => {
      if (cardRef.current && !menuOpen) {
        onHoverStart(cardRef.current.getBoundingClientRect());
      }
    }, 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    onHoverEnd?.();
  };

  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (open) {
      // Cancel hover preview when menu opens
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      onHoverEnd?.();
    }
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      const input = inputRef.current;
      // Mark that we just started editing to ignore immediate blur
      justStartedEditingRef.current = true;
      // Small timeout to ensure input is fully mounted
      setTimeout(() => {
        input.focus();
        input.select();
        // Clear the flag after focus is established
        setTimeout(() => {
          justStartedEditingRef.current = false;
        }, 100);
      }, 0);
    }
  }, [isEditing]);

  const handleRename = () => {
    // Ignore blur events that happen immediately after starting to edit
    if (justStartedEditingRef.current) return;

    if (editName.trim() && editName !== terminal.name && onRename) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const hasActions = onDelete || onRename;

  // Handle card click - coordinates selection with navigation
  const handleCardClick = (e: React.MouseEvent) => {
    if (isEditing) return;

    // If in select mode (any items selected), any click toggles selection
    if (isInSelectMode && onToggleSelect) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(e.shiftKey);
      return;
    }

    // Not in select mode - shift+click starts selection
    if (e.shiftKey && onToggleSelect) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(false);
      return;
    }

    // Normal click - navigate to terminal
    onClick?.();
  };

  // Handle checkbox click
  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelect?.(e.shiftKey);
  };

  // Shared menu items renderer for both context menu and dropdown
  const renderMenuItems = (isContextMenu: boolean) => {
    const MenuItem = isContextMenu ? ContextMenuItem : DropdownMenuItem;
    const MenuSeparator = isContextMenu
      ? ContextMenuSeparator
      : DropdownMenuSeparator;
    const MenuSub = isContextMenu ? ContextMenuSub : DropdownMenuSub;
    const MenuSubTrigger = isContextMenu
      ? ContextMenuSubTrigger
      : DropdownMenuSubTrigger;
    const MenuSubContent = isContextMenu
      ? ContextMenuSubContent
      : DropdownMenuSubContent;

    return (
      <>
        {onRename && (
          <MenuItem onClick={() => setIsEditing(true)}>
            <Pencil className="h-4 w-4" />
            Rename
          </MenuItem>
        )}
        {onDelete && (
          <>
            <MenuSeparator />
            <MenuItem
              onClick={() => onDelete()}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Delete terminal
            </MenuItem>
          </>
        )}
      </>
    );
  };

  const cardContent = (
    <div
      ref={cardRef}
      onClick={handleCardClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "group press-sm relative flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2.5 py-2 text-left",
        "min-h-[44px] md:min-h-[32px]",
        "transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
        isSelected
          ? "bg-primary/16 text-foreground"
          : isActive
            ? "bg-primary/12 text-foreground"
            : "hover:bg-[var(--fill-4)]"
      )}
    >
      {/* Selection checkbox - visible when in select mode */}
      {isInSelectMode && onToggleSelect && (
        <button
          onClick={handleCheckboxClick}
          aria-label={isSelected ? "Deselect terminal" : "Select terminal"}
          className="text-primary press hover:text-primary/80 flex-shrink-0"
        >
          {isSelected ? (
            <CheckSquare className="h-4 w-4" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") {
                  setEditName(terminal.name);
                  setIsEditing(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="ring-primary/50 min-w-0 flex-1 rounded-md bg-[var(--fill-3)] px-1.5 py-0.5 text-[0.8125rem] ring-2 outline-none"
            />
          ) : (
            <span
              // Double-click to rename, rather than hunting for the menu.
              onDoubleClick={(e) => {
                if (!onRename) return;
                e.stopPropagation();
                setEditName(terminal.name);
                setIsEditing(true);
              }}
              className="min-w-0 flex-1 truncate text-[0.8125rem] leading-tight tracking-[-0.006em]"
            >
              {terminal.name}
            </span>
          )}

          {/* Split indicator: a terminal tmux has split into panes. */}
          {terminal.panes > 1 && (
            <span
              className="text-muted-foreground flex-shrink-0 rounded-full bg-[var(--fill-2)] px-1.5 text-[0.625rem] leading-4 tabular-nums"
              title={terminal.panes + " tmux panes"}
            >
              {terminal.panes}
            </span>
          )}

          {/* Right slot. The timestamp keeps its box and only fades, while
              the menu button is lifted out of flow on desktop and overlays
              it. Toggling the button's display instead made the whole row
              reflow on hover; reserving a box for it left a dead gap. */}
          <span className="text-muted-foreground hidden flex-shrink-0 text-[0.6875rem] transition-opacity duration-200 sm:block md:group-hover:opacity-0">
            {timeAgo}
          </span>

          {/* Actions menu (button) */}
          {hasActions && (
            <DropdownMenu onOpenChange={handleMenuOpenChange}>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Terminal actions"
                  className="inline-flex h-8 w-8 flex-shrink-0 rounded-full transition-opacity duration-200 md:absolute md:top-1/2 md:right-1 md:h-7 md:w-7 md:-translate-y-1/2 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
              >
                {renderMenuItems(false)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
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

/** @param activity tmux last-activity stamp, in seconds since the epoch. */
function getTimeAgo(activity: number): string {
  if (!activity) return "";
  const now = new Date();
  const diffMs = now.getTime() - activity * 1000;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(activity * 1000).toLocaleDateString();
}
