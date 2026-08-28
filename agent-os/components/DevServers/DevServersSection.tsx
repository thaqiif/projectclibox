"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DevServerCard } from "./DevServerCard";
import type { DevServer, Project } from "@/lib/db";

interface DevServersSectionProps {
  servers: DevServer[];
  projects: Project[];
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRestart: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onViewLogs: (id: string) => void;
}

export function DevServersSection({
  servers,
  projects,
  onStart,
  onStop,
  onRestart,
  onRemove,
  onViewLogs,
}: DevServersSectionProps) {
  const [expanded, setExpanded] = useState(true);

  if (servers.length === 0) return null;

  // Count running servers
  const runningCount = servers.filter((s) => s.status === "running").length;

  // Create project lookup map
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="border-b border-[var(--fill-2)]">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "hover:bg-[var(--fill-4)] flex h-9 w-full items-center gap-2.5 px-3 text-left transition-colors"
        )}
      >
        <ChevronDown
          className={cn(
            "text-muted-foreground/70 h-3 w-3 shrink-0 transition-transform",
            !expanded && "-rotate-90"
          )}
        />
        <span className="ui-label">Dev servers</span>
        <span className="ml-auto flex items-center gap-2.5">
          {runningCount > 0 && (
            <span className="text-status-running flex items-center gap-1 text-[0.625rem] font-medium tracking-[0.045em] uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {runningCount} up
            </span>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            {servers.length}
          </span>
        </span>
      </button>

      {/* Service ledger */}
      {expanded && (
        <div className="divide-[var(--fill-3)] border-[var(--fill-2)] divide-y border-t">
          {servers.map((server, i) => (
            <DevServerCard
              key={server.id}
              server={server}
              index={i}
              projectName={projectMap.get(server.project_id)?.name}
              onStart={onStart}
              onStop={onStop}
              onRestart={onRestart}
              onRemove={onRemove}
              onViewLogs={onViewLogs}
            />
          ))}
        </div>
      )}
    </div>
  );
}
