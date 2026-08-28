"use client";

import { X, Plus, Minus, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnifiedDiff } from "./UnifiedDiff";
import { parseDiff, getDiffFileName, getDiffSummary } from "@/lib/diff-parser";

interface DiffModalProps {
  diff: string;
  fileName?: string;
  onClose: () => void;
  onStage?: () => void;
  onUnstage?: () => void;
  isStaged?: boolean;
}

export function DiffModal({
  diff,
  fileName,
  onClose,
  onStage,
  onUnstage,
  isStaged = false,
}: DiffModalProps) {
  const parsedDiff = parseDiff(diff);
  const displayName = fileName || getDiffFileName(parsedDiff);
  const summary = getDiffSummary(parsedDiff);

  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col">
      {/* Header */}
      <div className="glass glass-edge-bottom relative z-10 flex h-10 shrink-0 items-stretch justify-between">
        <button
          onClick={onClose}
          className="text-muted-foreground hover:bg-[var(--fill-3)] hover:text-foreground flex w-8 shrink-0 items-center justify-center border-r border-[var(--fill-2)] transition-colors"
          title="Back"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex min-w-0 flex-1 flex-col justify-center px-3">
          <p className="ui-meta truncate text-foreground">{displayName}</p>
          <span className="ui-label">{summary}</span>
        </div>

        {/* Stage/Unstage button */}
        {(onStage || onUnstage) && (
          <div className="flex shrink-0 items-center gap-2 px-2">
            <Button
              variant={isStaged ? "outline" : "default"}
              size="sm"
              onClick={isStaged ? onUnstage : onStage}
              className=""
            >
              {isStaged ? (
                <>
                  <Minus className="mr-1 h-3 w-3" />
                  Unstage
                </>
              ) : (
                <>
                  <Plus className="mr-1 h-3 w-3" />
                  Stage
                </>
              )}
            </Button>
          </div>
        )}

        <button
          onClick={onClose}
          className="text-muted-foreground hover:bg-[var(--fill-3)] hover:text-foreground flex w-8 shrink-0 items-center justify-center border-l border-[var(--fill-2)] transition-colors md:hidden"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="scrollbar-thin flex-1 overflow-auto p-3">
        {diff ? (
          <UnifiedDiff
            diff={parsedDiff}
            fileName={displayName}
            expanded={true}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <p className="ui-label">Nothing to show</p>
            <p className="ui-meta">no changes to display</p>
          </div>
        )}
      </div>

      {/* Mobile action bar */}
      <div className="bg-surface border-[var(--fill-2)] safe-area-bottom flex items-center justify-between border-t p-3 md:hidden">
        <div className="flex items-center gap-4 font-mono text-xs tabular-nums">
          {parsedDiff.additions > 0 && (
            <span className="text-status-running flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" />
              {parsedDiff.additions}
            </span>
          )}
          {parsedDiff.deletions > 0 && (
            <span className="text-status-error flex items-center gap-1">
              <Minus className="h-3.5 w-3.5" />
              {parsedDiff.deletions}
            </span>
          )}
        </div>

        {(onStage || onUnstage) && (
          <Button
            variant={isStaged ? "outline" : "default"}
            size="default"
            onClick={isStaged ? onUnstage : onStage}
            className="min-h-[44px]"
          >
            {isStaged ? "Unstage" : "Stage"}
          </Button>
        )}
      </div>
    </div>
  );
}

interface DiffViewProps {
  diff: string;
  fileName?: string;
}

/**
 * Inline diff view (non-modal)
 * For embedding in other components
 */
export function DiffView({ diff, fileName }: DiffViewProps) {
  const parsedDiff = parseDiff(diff);
  const displayName = fileName || getDiffFileName(parsedDiff);

  if (!diff) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4">
        <p className="ui-label">Nothing to show</p>
        <p className="ui-meta">no changes to display</p>
      </div>
    );
  }

  return (
    <UnifiedDiff diff={parsedDiff} fileName={displayName} expanded={true} />
  );
}
