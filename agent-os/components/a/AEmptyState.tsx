/**
 * AEmptyState — one shape for "there is nothing here yet" and "that failed".
 *
 * Empty states were being hand-rolled per panel, each with its own eyebrow,
 * its own mono shout and its own `❯ retry` affordance. Apple's version is
 * quieter and always the same: a dimmed glyph, a plain sentence saying what
 * is missing, a smaller one saying what to do, and at most one real button.
 *
 * @example
 * ```tsx
 * <AEmptyState icon={FolderOpen} title="No projects" description="…"
 *              action={{ label: "New project", onClick: create }} />
 * ```
 */

"use client";

import type { LucideIcon } from "lucide-react";
import { AButton } from "@/components/a/AButton";
import { cn } from "@/lib/utils";

export interface AEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; icon?: LucideIcon };
  /** Failure reads the same way, just tinted — it is still an empty panel. */
  tone?: "neutral" | "error";
  /** `compact` for sidebars and drawers, `default` for full panels. */
  size?: "compact" | "default";
  className?: string;
}

export function AEmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "neutral",
  size = "default",
  className,
}: AEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "compact" ? "gap-2 px-4 py-10" : "gap-3 px-6 py-16",
        className
      )}
    >
      {Icon && (
        <Icon
          aria-hidden="true"
          className={cn(
            size === "compact" ? "h-6 w-6" : "h-8 w-8",
            tone === "error" ? "text-status-error/70" : "text-muted-foreground/45"
          )}
          strokeWidth={1.5}
        />
      )}
      <div className="flex flex-col gap-1">
        <p
          className={cn(
            "font-medium tracking-[-0.006em]",
            size === "compact" ? "text-[0.8125rem]" : "text-[0.9375rem]",
            tone === "error" ? "text-status-error" : "text-foreground"
          )}
        >
          {title}
        </p>
        {description && (
          <p className="text-muted-foreground mx-auto max-w-[36ch] text-[0.75rem] leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && (
        <AButton
          size="sm"
          variant="secondary"
          icon={action.icon}
          onClick={action.onClick}
          className="mt-1"
        >
          {action.label}
        </AButton>
      )}
    </div>
  );
}
