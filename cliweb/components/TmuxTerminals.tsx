"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { RefreshCw, Terminal, MonitorUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface TmuxTerminal {
  name: string;
  windows: number;
  created: string;
  attached: boolean;
}

interface TmuxTerminalsProps {
  onAttach: (terminalName: string) => void;
}

export function TmuxTerminals({ onAttach }: TmuxTerminalsProps) {
  const [terminals, setTerminals] = useState<TmuxTerminal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTerminals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command:
            "tmux list-sessions -F '#{session_name}|#{session_windows}|#{session_created}|#{session_attached}' 2>/dev/null || echo ''",
        }),
      });
      const data = await res.json();

      if (data.success && data.output.trim()) {
        const parsed = data.output
          .trim()
          .split("\n")
          .filter((line: string) => line.includes("|"))
          .map((line: string) => {
            const [name, windows, created, attached] = line.split("|");
            return {
              name,
              windows: parseInt(windows),
              created: new Date(parseInt(created) * 1000).toLocaleString(),
              attached: attached === "1",
            };
          });
        setTerminals(parsed);
      } else {
        setTerminals([]);
      }
    } catch (err) {
      console.error("Failed to fetch tmux terminals:", err);
      setError("Failed to load");
      setTerminals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTerminals();
    // Refresh every 30 seconds
    const interval = setInterval(fetchTerminals, 30000);
    return () => clearInterval(interval);
  }, [fetchTerminals]);

  if (terminals.length === 0 && !loading && !error) {
    return null; // Don't show section if no tmux terminals
  }

  return (
    <div className="border-b border-[var(--fill-2)]">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="text-muted-foreground h-4 w-4" />
          <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            Tmux Terminals
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={fetchTerminals}
          disabled={loading}
          className="h-6 w-6"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="space-y-1 px-4 pb-3">
        {error && <p className="text-destructive text-xs">{error}</p>}
        {terminals.map((terminal) => (
          <button
            key={terminal.name}
            onClick={() => onAttach(terminal.name)}
            className={cn(
              "flex w-full items-center justify-between rounded-md p-2 text-left transition-colors",
              "hover:bg-primary/10 border",
              terminal.attached
                ? "border-primary/50 bg-primary/5"
                : "border-transparent"
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <MonitorUp className="text-primary h-4 w-4 flex-shrink-0" />
              <span className="truncate text-sm font-medium">
                {terminal.name}
              </span>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <span className="text-muted-foreground text-xs">
                {terminal.windows}w
              </span>
              {terminal.attached && (
                <Badge variant="success" className="px-1 py-0 text-[10px]">
                  attached
                </Badge>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
