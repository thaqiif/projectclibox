"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParsedDiff, DiffHunk, DiffLine } from "@/lib/diff-parser";

interface UnifiedDiffProps {
  diff: ParsedDiff;
  fileName: string;
  expanded?: boolean;
  onToggle?: () => void;
}

export function UnifiedDiff({
  diff,
  fileName,
  expanded = true,
  onToggle,
}: UnifiedDiffProps) {
  const [localExpanded, setLocalExpanded] = useState(expanded);
  const isExpanded = onToggle ? expanded : localExpanded;

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setLocalExpanded(!localExpanded);
    }
  };

  return (
    <div className="border-[var(--fill-2)] overflow-hidden border">
      {/* File header */}
      <button
        onClick={handleToggle}
        className={cn(
          "bg-surface hover:bg-[var(--fill-4)] flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
          "min-h-[44px]"
        )}
      >
        {isExpanded ? (
          <ChevronDown className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0" />
        )}

        <span className="ui-meta min-w-0 flex-1 truncate">{fileName}</span>

        {/* Stats */}
        <span className="flex flex-shrink-0 items-center gap-2 font-mono text-[0.6875rem] tabular-nums">
          {diff.additions > 0 && (
            <span className="flex items-center gap-0.5 text-status-running">
              <Plus className="h-3 w-3" />
              {diff.additions}
            </span>
          )}
          {diff.deletions > 0 && (
            <span className="flex items-center gap-0.5 text-status-error">
              <Minus className="h-3 w-3" />
              {diff.deletions}
            </span>
          )}
        </span>
      </button>

      {/* Diff content */}
      {isExpanded && (
        <div className="scrollbar-thin overflow-x-auto">
          {diff.isBinary ? (
            <div className="px-4 py-6 text-center">
              <p className="ui-label">Binary file</p>
              <p className="ui-meta">binary file not shown</p>
            </div>
          ) : diff.hunks.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="ui-label">No changes</p>
              <p className="ui-meta">no changes</p>
            </div>
          ) : (
            <div className="scrollbar-thin font-mono text-xs">
              {diff.hunks.map((hunk, index) => (
                <Hunk key={index} hunk={hunk} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface HunkProps {
  hunk: DiffHunk;
}

function Hunk({ hunk }: HunkProps) {
  return (
    <div>
      {/* Hunk header */}
      <div className="border-[var(--fill-2)] bg-status-info/10 text-status-info border-y px-3 py-1 text-[11px]">
        {hunk.header}
      </div>

      {/* Lines */}
      <table className="w-full border-collapse">
        <tbody>
          {hunk.lines.map((line, index) => (
            <DiffLineRow key={index} line={line} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DiffLineRowProps {
  line: DiffLine;
}

function DiffLineRow({ line }: DiffLineRowProps) {
  const bgColor = getLineBgColor(line.type);
  const textColor = getLineTextColor(line.type);

  // Skip header lines in the main content
  if (line.type === "header") {
    return null;
  }

  return (
    <tr className={cn("hover:bg-[var(--fill-4)]", bgColor)}>
      {/* Old line number */}
      <td className="text-muted-foreground/70 border-[var(--fill-3)] w-12 border-r px-2 py-0.5 text-right tabular-nums select-none">
        {line.oldLineNumber || ""}
      </td>

      {/* New line number */}
      <td className="text-muted-foreground/70 border-[var(--fill-3)] w-12 border-r px-2 py-0.5 text-right tabular-nums select-none">
        {line.newLineNumber || ""}
      </td>

      {/* Line marker */}
      <td className={cn("w-6 px-1 py-0.5 text-center select-none", textColor)}>
        {getLineMarker(line.type)}
      </td>

      {/* Content */}
      <td className={cn("px-2 py-0.5 whitespace-pre", textColor)}>
        {line.content || " "}
      </td>
    </tr>
  );
}

function getLineBgColor(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "bg-status-running/10";
    case "deletion":
      return "bg-status-error/10";
    default:
      return "";
  }
}

function getLineTextColor(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "text-status-running";
    case "deletion":
      return "text-status-error";
    default:
      return "text-foreground";
  }
}

function getLineMarker(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "+";
    case "deletion":
      return "-";
    default:
      return "";
  }
}
