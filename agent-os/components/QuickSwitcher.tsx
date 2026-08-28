"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Terminal, GitBranch, Check, Search } from "lucide-react";
import type { TerminalRecord } from "@/lib/terminals";
import { CodeSearchResults } from "@/components/CodeSearch/CodeSearchResults";
import { useRipgrepAvailable } from "@/data/code-search";
import { AEmptyState } from "@/components/a/AEmptyState";

export interface QuickSwitcherProps {
  terminals: TerminalRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTerminal: (terminalId: string) => void;
  onSelectFile?: (file: string, line: number) => void;
  currentTerminalId?: string;
  activeTerminalWorkingDir?: string;
}

function ModeCell({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        "press-sm focus-ring flex h-7 items-center rounded-full px-3 text-[0.75rem] font-medium",
        "transition-colors duration-200",
        active
          ? "bg-[var(--fill-1)] text-foreground shadow-[var(--elev-1)]"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

/**
 * Quick terminal switcher with search
 * Triggered by Cmd+K or button tap
 */
export function QuickSwitcher({
  terminals,
  open,
  onOpenChange,
  onSelectTerminal,
  onSelectFile,
  currentTerminalId,
  activeTerminalWorkingDir,
}: QuickSwitcherProps) {
  const [mode, setMode] = useState<"terminals" | "code">("terminals");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check if ripgrep is available
  const { data: ripgrepAvailable } = useRipgrepAvailable();

  // Filter terminals based on search query
  const filteredTerminals = terminals.filter((terminal) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      terminal.name?.toLowerCase().includes(q) ||
      terminal.working_directory?.toLowerCase().includes(q) ||
      terminal.agent_type?.toLowerCase().includes(q)
    );
  });

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => {
      setMode("terminals");
      setQuery("");
      setSelectedIndex(0);
    });
    const focusTimeout = setTimeout(() => inputRef.current?.focus(), 50);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(focusTimeout);
    };
  }, [open]);

  // Force terminals mode if ripgrep is not available
  useEffect(() => {
    if (ripgrepAvailable !== false || mode !== "code") return;

    const frame = requestAnimationFrame(() => setMode("terminals"));
    return () => cancelAnimationFrame(frame);
  }, [ripgrepAvailable, mode]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            Math.min(prev + 1, filteredTerminals.length - 1)
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredTerminals[selectedIndex]) {
            onSelectTerminal(filteredTerminals[selectedIndex].id);
            onOpenChange(false);
          }
          break;
        case "Escape":
          e.preventDefault();
          onOpenChange(false);
          break;
      }
    },
    [filteredTerminals, selectedIndex, onSelectTerminal, onOpenChange]
  );

  // Format relative time
  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    const now = new Date();
    const date = new Date(dateStr);
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // Handle file selection from code search
  const handleSelectFile = useCallback(
    (file: string, line: number) => {
      onOpenChange(false);
      onSelectFile?.(file, line);
    },
    [onOpenChange, onSelectFile]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-lg"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Switch Terminal / Search Code</DialogTitle>
        </DialogHeader>

        {/* Header strip */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3">
          <span className="ui-label">Quick switch</span>
          {ripgrepAvailable === true && (
            <div
              role="tablist"
              className="flex items-center gap-0.5 rounded-full bg-[var(--fill-4)] p-0.5"
            >
              <ModeCell
                label="Terminals"
                active={mode === "terminals"}
                onClick={() => setMode("terminals")}
              />
              <ModeCell
                label="Code"
                active={mode === "code"}
                onClick={() => setMode("code")}
              />
            </div>
          )}
        </div>

        {/* Search Input */}
        <div className="px-4 pt-2.5 pb-2">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              ref={inputRef}
              placeholder={
                mode === "terminals" || !ripgrepAvailable
                  ? "Search terminals"
                  : "Search code (min 3 characters)"
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={mode === "terminals" ? handleKeyDown : undefined}
              className="h-10 rounded-xl pl-9 text-[0.875rem] md:text-[0.875rem]"
            />
          </div>
        </div>

        {/* Content */}
        <div className="scrollbar-thin max-h-[340px] overflow-y-auto px-2 pb-2">
          {mode === "terminals" ? (
            filteredTerminals.length === 0 ? (
              <AEmptyState
                size="compact"
                icon={Terminal}
                title="No terminals found"
                description="Nothing matches that search."
              />
            ) : (
              filteredTerminals.map((terminal, index) => {
                const isSelected = index === selectedIndex;
                const isCurrent = terminal.id === currentTerminalId;
                // tmux reports last activity in seconds since the epoch.
                const time = formatTime(
                  new Date(terminal.activity * 1000).toISOString()
                );
                return (
                  <button
                    key={terminal.id}
                    onClick={() => {
                      onSelectTerminal(terminal.id);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "press-sm relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left",
                      "transition-colors duration-200",
                      isSelected
                        ? "bg-primary/14 text-foreground"
                        : "hover:bg-[var(--fill-4)]"
                    )}
                  >
                    <Terminal
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isSelected ? "text-primary" : "text-muted-foreground"
                      )}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[0.875rem] leading-tight tracking-[-0.006em]">
                          {terminal.name || "Unnamed Terminal"}
                        </span>
                        {isCurrent && (
                          <Check className="text-primary h-3.5 w-3.5 shrink-0" />
                        )}
                      </div>
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate text-[0.75rem]">
                        <span>{terminal.agent_type || "shell"}</span>
                        <span className="text-muted-foreground/70">·</span>
                        <span className="truncate">
                          {terminal.working_directory?.split("/").pop() || "~"}
                        </span>
                        {time && (
                          <>
                            <span className="text-muted-foreground/70">·</span>
                            <span className="shrink-0">{time}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )
          ) : (
            <CodeSearchResults
              workingDirectory={activeTerminalWorkingDir || "~"}
              query={query}
              onSelectFile={handleSelectFile}
            />
          )}
        </div>

        {/* Footer Hint */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <span className="text-muted-foreground/80 flex items-center gap-2 text-[0.6875rem]">
            <kbd className="rounded bg-[var(--fill-2)] px-1.5 py-0.5">↑↓</kbd>
            navigate
            <kbd className="rounded bg-[var(--fill-2)] px-1.5 py-0.5">↵</kbd>
            open
            <kbd className="rounded bg-[var(--fill-2)] px-1.5 py-0.5">esc</kbd>
            close
          </span>
          {mode === "terminals" && (
            <span className="text-muted-foreground/80 text-[0.6875rem] tabular-nums">
              {filteredTerminals.length}
              {filteredTerminals.length === 1 ? " terminal" : " terminals"}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
