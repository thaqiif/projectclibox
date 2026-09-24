"use client";

/**
 * NarrowList: pure presentational filter component for the file explorer.
 *
 * Renders a small filter input and passes the current term up via
 * `onFilterChange`. It does NO filtering itself: the parent combines the
 * term with `matchesFilter` (see @/lib/file-utils) and decides what to
 * show. This keeps NarrowList free of tree-walking logic and easy to
 * drop into any list view.
 *
 * Designed as an isolated component: the parent (FileExplorer index.tsx)
 * can wire it in without NarrowList knowing anything about the tree
 * render, selection state, or file operations.
 */

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface NarrowListProps {
  /** Files/rows to display after the parent has applied its filter. */
  nodes: { name: string; type: "file" | "directory" }[];
  /** Current filter term (empty string = show all). */
  filter: string;
  onFilterChange: (term: string) => void;
  /** Called when a row is clicked / Enter'd. */
  onSelect: (name: string) => void;
  /** Optional node selection highlight. */
  selectedName?: string | null;
  /** Optional extra classes for the wrapper. */
  className?: string;
  /** Message shown when `nodes` is empty (e.g. filter matched nothing). */
  emptyMessage?: string;
}

export function NarrowList({
  nodes,
  filter,
  onFilterChange,
  onSelect,
  selectedName,
  className,
  emptyMessage = "No matches",
}: NarrowListProps) {
  const rows = nodes.length === 0;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="text"
          role="searchbox"
          aria-label="Filter file list"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter files..."
          className="h-7 w-full rounded-md border border-border bg-background/60 pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {filter !== "" && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => onFilterChange("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>

      {rows ? (
        <div className="px-2 py-3 text-xs text-muted-foreground">{emptyMessage}</div>
      ) : (
        <ul className="mt-1 min-h-0 flex-1 overflow-y-auto">
          {nodes.map((node) => (
            <li key={node.name}>
              <button
                type="button"
                onClick={() => onSelect(node.name)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs",
                  node.type === "directory" && "font-medium",
                  selectedName === node.name
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
              >
                <span className="truncate">{node.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}