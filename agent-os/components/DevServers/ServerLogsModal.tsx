"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ServerLogsModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

export function ServerLogsModal({
  serverId,
  serverName,
  onClose,
}: ServerLogsModalProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await fetch(`/api/dev-servers/${serverId}/logs?lines=200`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [serverId]);

  // Initial fetch
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  // Auto-refresh every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLogs(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[3px]">
      <div
        className={cn(
          "flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden",
          "bg-background lift-in rounded-2xl shadow-[var(--elev-4)]"
        )}
      >
        {/* Header */}
        <div className="glass glass-edge-bottom relative z-10 flex shrink-0 items-center gap-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="type-headline truncate">{serverName}</h2>
            <p className="ui-label">Logs</p>
          </div>
          <button
            onClick={() => fetchLogs(true)}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh logs"
            className={cn(
              "press-sm focus-ring text-muted-foreground hover:text-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--fill-3)] transition-colors",
              "disabled:pointer-events-none disabled:opacity-30"
            )}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
          </button>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="press-sm focus-ring text-muted-foreground hover:text-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--fill-3)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Log terminal */}
        <div
          ref={logsRef}
          className={cn(
            "scrollbar-thin flex-1 overflow-auto p-3",
            "bg-background font-mono text-xs leading-relaxed"
          )}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2">
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
              <span className="type-subhead text-muted-foreground">
                Loading logs
              </span>
            </div>
          ) : logs.length === 0 ? (
            <div className="type-subhead text-muted-foreground flex h-full items-center justify-center">
              No output
            </div>
          ) : (
            <div className="space-y-0.5">
              {logs.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    "break-all whitespace-pre-wrap",
                    line.includes("error") || line.includes("Error")
                      ? "text-status-error"
                      : line.includes("warn") || line.includes("Warning")
                        ? "text-status-waiting"
                        : "text-muted-foreground"
                  )}
                >
                  {line || " "}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="edge-fade-top text-muted-foreground flex shrink-0 items-center justify-between px-5 py-3">
          <span className="ui-meta">Auto-refresh every 3 seconds</span>
          {refreshing && (
            <RefreshCw className="text-muted-foreground inline h-3 w-3 animate-spin" />
          )}
        </div>
      </div>
    </div>
  );
}
