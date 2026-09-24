"use client";

/**
 * ListFilter: isolated filter bar for the file explorer.
 *
 * This is a NEW, self-contained component. It intentionally does NOT import
 * or modify FileExplorer/index.tsx (owned by the dnd-explorer agent). The
 * parent wires it in with a unique marker comment, e.g.:
 *
 *   // FILTER_INTEGRATION: ListFilter (owned elsewhere)
 *   const [filter, setFilter] = useState("");
 *   const filtered = useMemo(
 *     () => nodes.filter((n) => matchesFilter(n, filter)),
 *     [nodes, filter]
 *   );
 *   <ListFilter value={filter} onChange={setFilter} />
 *   <Tree nodes={filtered} />
 *
 * `matchesFilter` lives in @/lib/file-utils (append-only addition there).
 */

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ListFilterProps {
  /** Current filter term, controlled by the parent. */
  value: string;
  onChange: (value: string) => void;
  /** Placeholder hint inside the input. */
  placeholder?: string;
  /** Extra classes for the outer wrapper. */
  className?: string;
}

export function ListFilter({
  value,
  onChange,
  placeholder = "Filter...",
  className,
}: ListFilterProps) {
  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="text"
        role="searchbox"
        aria-label="Filter list"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 w-full rounded-md border border-border bg-background/60 pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {value !== "" && (
        <button
          type="button"
          aria-label="Clear filter"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}