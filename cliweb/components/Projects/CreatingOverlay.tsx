"use client";

import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepConfig {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface CreatingOverlayProps {
  step: string;
  steps: StepConfig[];
  hint?: string;
}

/**
 * Full-screen progress overlay for multi-step project creation.
 *
 * Previously lived under NewTerminalDialog and carried a default set of
 * worktree steps. Worktrees went with the terminal model; the only caller
 * left is the clone flow, which supplies its own steps.
 */
export function CreatingOverlay({ step, steps, hint }: CreatingOverlayProps) {
  const currentIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="bg-background/80 fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 backdrop-blur-lg">
      <div className="flex flex-col items-center gap-1">
        <p className="type-title-3">Setting up your project</p>
        <p className="text-muted-foreground text-[0.8125rem]">
          Hang tight — this only happens once.
        </p>
      </div>
      <div className="glass-thick glass-float lift-in w-full max-w-xs rounded-2xl p-2">
        {steps.map((s, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <div
              key={s.id}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2.5 py-2 text-[0.8125rem]",
                "transition-colors duration-200",
                isComplete && "text-muted-foreground",
                isCurrent && "text-foreground bg-[var(--fill-4)] font-medium",
                !isComplete && !isCurrent && "text-muted-foreground/50"
              )}
            >
              <span className="flex-1">{s.label}</span>
              {isComplete ? (
                <Check className="text-status-running h-4 w-4 shrink-0" />
              ) : isCurrent ? (
                <span className="animate-status-pulse bg-primary h-2 w-2 shrink-0 rounded-full" />
              ) : (
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--fill-1)]" />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground text-[0.75rem]">
        {hint ?? "This may take a minute for large codebases"}
      </p>
    </div>
  );
}
