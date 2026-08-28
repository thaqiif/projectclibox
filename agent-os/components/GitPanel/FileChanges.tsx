"use client";

import { useState, useRef, useCallback } from "react";
import {
  Plus,
  Minus,
  ChevronRight,
  Check,
  MoreVertical,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { GitFile } from "@/lib/git-status";
import type { MultiRepoGitFile } from "@/lib/multi-repo-git";

type AnyGitFile = GitFile | MultiRepoGitFile;

interface FileChangesProps {
  files: AnyGitFile[];
  title: string;
  emptyMessage: string;
  selectedPath?: string;
  onFileClick: (file: AnyGitFile) => void;
  onStage?: (file: AnyGitFile) => void;
  onUnstage?: (file: AnyGitFile) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onDiscard?: (file: AnyGitFile) => void;
  isStaged?: boolean;
  groupByRepo?: boolean;
}

const SWIPE_THRESHOLD = 80;

export function FileChanges({
  files,
  title,
  emptyMessage,
  selectedPath,
  onFileClick,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
  onDiscard,
  isStaged = false,
  groupByRepo = false,
}: FileChangesProps) {
  const [expanded, setExpanded] = useState(true);

  if (files.length === 0) {
    return null;
  }

  const showAllButton = files.length > 1 && (onStageAll || onUnstageAll);
  const sectionLabel = isStaged
    ? "staged"
    : title.toLowerCase().includes("untracked")
      ? "untracked"
      : "changes";

  // Group files by repo if enabled
  const groupedFiles = groupByRepo
    ? (() => {
        const grouped = new Map<string, AnyGitFile[]>();
        for (const f of files) {
          const repoKey = "repoName" in f && f.repoName ? f.repoName : "";
          const existing = grouped.get(repoKey) || [];
          existing.push(f);
          grouped.set(repoKey, existing);
        }
        return Array.from(grouped.entries());
      })()
    : [["", files] as [string, AnyGitFile[]]];

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform",
              expanded && "rotate-90"
            )}
          />
          <span className="ui-label">
            {sectionLabel} <span className="tabular-nums">{files.length}</span>
          </span>
        </button>
        {showAllButton && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              isStaged ? onUnstageAll?.() : onStageAll?.();
            }}
            className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-[0.75rem] font-medium transition-colors"
          >
            {isStaged ? (
              <Minus className="h-3 w-3" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            All
          </button>
        )}
      </div>

      {expanded && (
        <div className="divide-y divide-[var(--fill-3)]">
          {groupedFiles.map(([repoName, repoFiles]) => (
            <div key={repoName || "default"}>
              {repoName && (
                <div className="bg-surface ui-meta mx-2 mt-1 mb-1 border border-[var(--fill-2)] px-2 py-1">
                  {repoName}
                </div>
              )}
              {repoFiles.map((file) => {
                const fileKey =
                  "repoPath" in file
                    ? `${file.repoPath}-${file.path}`
                    : file.path;
                return (
                  <FileItem
                    key={fileKey}
                    file={file}
                    isSelected={file.path === selectedPath}
                    onClick={() => onFileClick(file)}
                    onStage={onStage ? () => onStage(file) : undefined}
                    onUnstage={onUnstage ? () => onUnstage(file) : undefined}
                    onDiscard={onDiscard ? () => onDiscard(file) : undefined}
                    onSwipeLeft={isStaged ? () => onUnstage?.(file) : undefined}
                    onSwipeRight={!isStaged ? () => onStage?.(file) : undefined}
                    isStaged={isStaged}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface FileItemProps {
  file: AnyGitFile;
  isSelected?: boolean;
  onClick: () => void;
  onStage?: () => void;
  onUnstage?: () => void;
  onDiscard?: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  isStaged: boolean;
}

function FileItem({
  file,
  isSelected = false,
  onClick,
  onStage,
  onUnstage,
  onDiscard,
  onSwipeLeft,
  onSwipeRight,
  isStaged,
}: FileItemProps) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startXRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    setIsSwiping(true);
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isSwiping) return;

      const currentX = e.touches[0].clientX;
      const diff = currentX - startXRef.current;

      // Limit swipe direction based on whether we can stage/unstage
      if (diff > 0 && !onSwipeRight) return;
      if (diff < 0 && !onSwipeLeft) return;

      // Add resistance at the edges
      const maxSwipe = 100;
      const resistedDiff =
        diff > 0 ? Math.min(diff, maxSwipe) : Math.max(diff, -maxSwipe);

      setSwipeOffset(resistedDiff);
    },
    [isSwiping, onSwipeLeft, onSwipeRight]
  );

  const handleTouchEnd = useCallback(() => {
    setIsSwiping(false);

    // Trigger action if swipe threshold reached
    if (swipeOffset > SWIPE_THRESHOLD && onSwipeRight) {
      onSwipeRight();
    } else if (swipeOffset < -SWIPE_THRESHOLD && onSwipeLeft) {
      onSwipeLeft();
    }

    // Reset position
    setSwipeOffset(0);
  }, [swipeOffset, onSwipeLeft, onSwipeRight]);

  const statusGlyph = getStatusGlyph(file.status);
  const statusColor = getStatusColor(file.status);
  const fileName = file.path.split("/").pop() || file.path;
  const filePath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <div
      ref={containerRef}
      className="group relative overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Background action indicators */}
      <div className="absolute inset-0 flex">
        {/* Stage indicator (swipe right) */}
        {onSwipeRight && (
          <div
            className={cn(
              "flex items-center justify-start bg-status-running/10 pl-4",
              swipeOffset > 0 ? "flex-1" : "w-0"
            )}
            style={{ width: swipeOffset > 0 ? `${swipeOffset}px` : 0 }}
          >
            {swipeOffset > SWIPE_THRESHOLD / 2 && (
              <Plus className="text-status-running h-4 w-4" />
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Unstage indicator (swipe left) */}
        {onSwipeLeft && (
          <div
            className={cn(
              "flex items-center justify-end bg-status-waiting/10 pr-4",
              swipeOffset < 0 ? "flex-1" : "w-0"
            )}
            style={{
              width: swipeOffset < 0 ? `${Math.abs(swipeOffset)}px` : 0,
            }}
          >
            {swipeOffset < -SWIPE_THRESHOLD / 2 && (
              <Minus className="text-status-waiting h-4 w-4" />
            )}
          </div>
        )}
      </div>

      {/* File item */}
      <div
        className={cn(
          "relative flex min-h-8 w-full items-center gap-2 py-1.5 pl-3 pr-2",
          "transition-colors",
          isSelected ? "bg-[var(--fill-3)]" : "bg-background hover:bg-[var(--fill-4)]"
        )}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isSwiping ? "none" : "transform 0.2s ease-out",
        }}
      >
        {/* Selected marker */}
        {isSelected && (
          <span className="bg-primary absolute inset-y-0 left-0 w-0.5" />
        )}

        {/* Clickable area for file */}
        <button
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {/* Status glyph */}
          <span
            className={cn(
              "flex h-4 w-4 flex-shrink-0 items-center justify-center text-[0.6875rem] font-medium",
              statusColor
            )}
          >
            {statusGlyph}
          </span>

          {/* File info */}
          <div className="min-w-0 flex-1">
            <span className="block truncate text-xs text-foreground">
              {fileName}
            </span>
            {filePath && (
              <span className="ui-meta block truncate">{filePath}</span>
            )}
          </div>
        </button>

        {/* Action buttons - visible on hover (desktop) */}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {/* Stage/Unstage button */}
          {isStaged
            ? onUnstage && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnstage();
                  }}
                  className="text-status-waiting hover:bg-[var(--fill-3)] flex h-7 w-7 items-center justify-center transition-colors"
                  title="Unstage"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              )
            : onStage && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStage();
                  }}
                  className="text-status-running hover:bg-[var(--fill-3)] flex h-7 w-7 items-center justify-center transition-colors"
                  title="Stage"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}

          {/* Context menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground hover:bg-[var(--fill-3)] flex h-7 w-7 items-center justify-center transition-colors"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isStaged
                ? onUnstage && (
                    <DropdownMenuItem onClick={onUnstage}>
                      <Minus className="mr-2 h-3.5 w-3.5" />
                      Unstage
                    </DropdownMenuItem>
                  )
                : onStage && (
                    <DropdownMenuItem onClick={onStage}>
                      <Plus className="mr-2 h-3.5 w-3.5" />
                      Stage
                    </DropdownMenuItem>
                  )}
              {onDiscard && !isStaged && (
                <DropdownMenuItem
                  onClick={onDiscard}
                  className="text-status-error focus:text-status-error"
                >
                  <Undo2 className="mr-2 h-3.5 w-3.5" />
                  Discard Changes
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Staged indicator - always visible */}
        {isStaged && (
          <Check className="text-status-running h-3.5 w-3.5 flex-shrink-0 group-hover:hidden" />
        )}

        {/* Arrow - visible when not hovering */}
        <ChevronRight className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0 group-hover:hidden" />
      </div>
    </div>
  );
}

function getStatusGlyph(status: GitFile["status"]): string {
  switch (status) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "untracked":
      return "U";
    case "renamed":
      return "R";
    default:
      return "·";
  }
}

function getStatusColor(status: GitFile["status"]): string {
  switch (status) {
    case "modified":
      return "text-status-waiting";
    case "added":
      return "text-status-running";
    case "deleted":
      return "text-status-error";
    case "renamed":
      return "text-status-info";
    case "untracked":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}
