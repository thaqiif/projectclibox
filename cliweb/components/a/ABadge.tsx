/**
 * ABadge - Standard badge component for the design system
 *
 * A consistent badge for labels, statuses, and feature indicators.
 *
 * @example
 * ```tsx
 * // Simple badge
 * <ABadge>Default</ABadge>
 *
 * // New feature indicator
 * <ABadge variant="new">New</ABadge>
 *
 * // Beta indicator
 * <ABadge variant="beta">Beta</ABadge>
 *
 * // Small size
 * <ABadge size="sm" variant="new">New</ABadge>
 * ```
 */

"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ABadgeSize = "sm" | "md";
export type ABadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "new"
  | "beta"
  | "pro"
  | "waiting"
  | "running"
  | "idle";

export interface ABadgeProps {
  /** Badge content */
  children: React.ReactNode;
  /** Badge style variant */
  variant?: ABadgeVariant;
  /** Badge size */
  size?: ABadgeSize;
  /** Additional className */
  className?: string;
}

const SIZE_CLASSES: Record<ABadgeSize, string> = {
  sm: "h-[1.125rem] px-1.5 py-0 text-[0.625rem] leading-none",
  md: "h-5 px-2 py-0 text-[0.6875rem] leading-none",
};

/* Status colour lives in the fill and the label, never in a ring around
   them — an outlined chip reads as a control the user can press. */
const VARIANT_CLASSES: Record<ABadgeVariant, string> = {
  default: "",
  secondary: "",
  destructive: "",
  outline: "",
  new: "bg-status-running/14 text-status-running",
  beta: "bg-status-waiting/14 text-status-waiting",
  pro: "bg-primary/14 text-primary",
  waiting: "bg-status-waiting/14 text-status-waiting",
  running: "bg-status-running/14 text-status-running",
  idle: "bg-[var(--fill-2)] text-muted-foreground",
};

const BASE_VARIANT_MAP: Record<
  ABadgeVariant,
  "default" | "secondary" | "destructive" | "outline"
> = {
  default: "default",
  secondary: "secondary",
  destructive: "destructive",
  outline: "outline",
  new: "secondary",
  beta: "secondary",
  pro: "secondary",
  waiting: "secondary",
  running: "secondary",
  idle: "secondary",
};

export function ABadge({
  children,
  variant = "default",
  size = "md",
  className,
}: ABadgeProps) {
  const isCustomVariant = [
    "new",
    "beta",
    "pro",
    "waiting",
    "running",
    "idle",
  ].includes(variant);

  return (
    <Badge
      variant={BASE_VARIANT_MAP[variant]}
      className={cn(
        "flex items-center justify-center font-medium",
        SIZE_CLASSES[size],
        isCustomVariant && VARIANT_CLASSES[variant],
        className
      )}
    >
      {children}
    </Badge>
  );
}
