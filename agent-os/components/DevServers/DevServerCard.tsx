"use client";

import { useState } from "react";
import {
  Play,
  Square,
  RefreshCw,
  FileText,
  Trash2,
  Copy,
  Check,
  Server,
  Container,
  X,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import type { DevServer, DevServerStatus } from "@/lib/db";

interface DevServerCardProps {
  server: DevServer;
  index?: number;
  projectName?: string;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRestart: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onViewLogs: (id: string) => void;
}

const statusConfig: Record<
  DevServerStatus,
  { glyph: "dot" | "pulse" | "cross" | "hollow"; color: string; label: string }
> = {
  running: {
    glyph: "dot",
    color: "text-status-running",
    label: "Running",
  },
  stopped: {
    glyph: "hollow",
    color: "text-muted-foreground/70",
    label: "Stopped",
  },
  starting: {
    glyph: "pulse",
    color: "text-status-waiting",
    label: "Starting",
  },
  failed: {
    glyph: "cross",
    color: "text-status-error",
    label: "Failed",
  },
};

function StatusGlyph({
  glyph,
  color,
}: {
  glyph: "dot" | "pulse" | "cross" | "hollow";
  color: string;
}) {
  if (glyph === "cross") {
    return <X className={cn("h-3 w-3 shrink-0 stroke-[3]", color)} />;
  }
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        glyph === "dot" && "bg-current",
        glyph === "pulse" && "animate-status-pulse border border-current",
        glyph === "hollow" && "border border-current",
        color
      )}
    />
  );
}

export function DevServerCard({
  server,
  index,
  projectName,
  onStart,
  onStop,
  onRestart,
  onRemove,
  onViewLogs,
}: DevServerCardProps) {
  const [loading, setLoading] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const status = statusConfig[server.status] || statusConfig.stopped;
  const ports: number[] = JSON.parse(server.ports || "[]");
  const primaryPort = ports[0];
  const isRunning = server.status === "running";
  const isStopped = server.status === "stopped";
  const isFailed = server.status === "failed";

  const handleAction = async (action: () => Promise<void>) => {
    setLoading(true);
    try {
      await action();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg px-3 py-2 transition-colors",
        !isStopped && "bg-surface-raised/40",
        "hover:bg-[var(--fill-4)]"
      )}
    >
      {/* Service row */}
      <div className="flex items-center gap-2.5">
        <span className="w-4 shrink-0 text-[0.625rem] text-muted-foreground/70">
          {typeof index === "number"
            ? String(index + 1)
            : "--"}
        </span>

        <StatusGlyph glyph={status.glyph} color={status.color} />

        <span className="flex-1 truncate text-sm font-medium">
          {server.name}
        </span>

        <span className="text-muted-foreground/70 flex shrink-0 items-center gap-1 text-[0.625rem] font-medium tracking-[0.045em] uppercase">
          {server.type === "docker" ? (
            <Container className="h-3 w-3" />
          ) : (
            <Server className="h-3 w-3" />
          )}
          {server.type}
        </span>
      </div>

      {/* Meta ledger */}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[26px]">
        <span className="ui-meta min-w-0 truncate">$ {server.command}</span>
        {server.pid !== null && (
          <span className="ui-meta text-muted-foreground/70 shrink-0">
            pid {server.pid}
          </span>
        )}
        {server.pid === null && server.container_id && (
          <span className="ui-meta text-muted-foreground/70 shrink-0">
            ctr {server.container_id.slice(0, 12)}
          </span>
        )}
        {projectName && (
          <span className="ui-meta text-muted-foreground/70 shrink-0 truncate">
            {projectName}
          </span>
        )}

        {primaryPort &&
          (isRunning ? (
            <a
              href={`http://localhost:${primaryPort}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open http://localhost:${primaryPort}`}
              className="ui-meta text-primary hover:text-primary/80 flex shrink-0 items-center gap-1 transition-colors"
            >
              localhost:{primaryPort}
              <ExternalLink className="h-3 w-3" />
              open ↗
            </a>
          ) : (
            <span className="ui-meta text-muted-foreground shrink-0">
              localhost:{primaryPort}
            </span>
          ))}

        {primaryPort && isRunning && (
          <button
            onClick={() => primaryPort && copy(`localhost:${primaryPort}`)}
            disabled={!isRunning}
            title="Copy URL"
            className={cn(
              "shrink-0 transition-colors",
              copied ? "text-status-running" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        )}
      </div>

      {/* Utility actions */}
      <div className="mt-1.5 flex items-center gap-1 pl-[26px]">
        {isRunning &&
          (confirmingStop ? (
            <>
              <ActionButton
                icon={Square}
                label="Confirm"
                onClick={() => {
                  setConfirmingStop(false);
                  handleAction(() => onStop(server.id));
                }}
                disabled={loading}
                variant="danger"
              />
              <ActionButton
                icon={X}
                label="Cancel"
                onClick={() => setConfirmingStop(false)}
                disabled={loading}
              />
            </>
          ) : (
            <>
              <ActionButton
                icon={Square}
                label="Stop"
                onClick={() => setConfirmingStop(true)}
                disabled={loading}
                variant="danger"
              />
              <ActionButton
                icon={RefreshCw}
                label="Restart"
                onClick={() => handleAction(() => onRestart(server.id))}
                disabled={loading}
              />
              <ActionButton
                icon={FileText}
                label="Logs"
                onClick={() => onViewLogs(server.id)}
                disabled={loading}
              />
            </>
          ))}

        {isStopped && (
          <>
            <ActionButton
              icon={Play}
              label="Start"
              onClick={() => handleAction(() => onStart(server.id))}
              disabled={loading}
              variant="primary"
            />
            <ActionButton
              icon={Trash2}
              label="Remove"
              onClick={() => handleAction(() => onRemove(server.id))}
              disabled={loading}
              variant="danger"
            />
          </>
        )}

        {isFailed && (
          <>
            <ActionButton
              icon={Play}
              label="Start"
              onClick={() => handleAction(() => onStart(server.id))}
              disabled={loading}
              variant="primary"
            />
            <ActionButton
              icon={FileText}
              label="Logs"
              onClick={() => onViewLogs(server.id)}
              disabled={loading}
            />
            <ActionButton
              icon={Trash2}
              label="Remove"
              onClick={() => handleAction(() => onRemove(server.id))}
              disabled={loading}
              variant="danger"
            />
          </>
        )}

        {server.status === "starting" && (
          <span className="ui-meta flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3 animate-spin" />
            starting
          </span>
        )}
      </div>
    </div>
  );
}

interface ActionButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant = "default",
}: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "flex h-6 items-center gap-1.5 px-1.5 text-[0.75rem] font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "text-primary hover:text-primary/80",
        variant === "danger" &&
          "text-muted-foreground hover:bg-destructive/10 hover:text-status-error",
        variant === "default" &&
          "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-3 w-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
