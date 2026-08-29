"use client";

import { forwardRef } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  visible: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClose: () => void;
  matchCount?: number;
  matchTotal?: number;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  (
    {
      visible,
      query,
      onQueryChange,
      onFindNext,
      onFindPrevious,
      onClose,
      matchCount,
      matchTotal,
    },
    ref
  ) => {
    if (!visible) return null;

    return (
      <div
        className={cn(
          "glass glass-edge-bottom relative z-20 flex items-center gap-1.5 px-3 py-1.5",
          "focus-within:ring-primary/40 focus-within:ring-2 focus-within:ring-inset"
        )}
      >
        <Search className="text-muted-foreground/70 h-4 w-4 shrink-0" />
        <input
          ref={ref}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search in terminal..."
          className={cn(
            "placeholder:text-muted-foreground/70 text-foreground min-w-0 flex-1 bg-transparent py-1.5 text-[0.8125rem]",
            "focus:outline-none"
          )}
        />
        {matchTotal !== undefined && (
          <span className="text-muted-foreground shrink-0 text-[0.6875rem] tabular-nums">
            {matchCount ?? 0}/{matchTotal}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          <button
            onClick={onFindPrevious}
            className="press focus-ring text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--fill-3)]"
            title="Previous (Shift+Enter)"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onFindNext}
            className="press focus-ring text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--fill-3)]"
            title="Next (Enter)"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="press focus-ring text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--fill-3)]"
            title="Close (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }
);

SearchBar.displayName = "SearchBar";
