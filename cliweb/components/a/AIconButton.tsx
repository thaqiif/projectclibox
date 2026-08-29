/**
 * AIconButton - Icon button component for the design system
 *
 * A consistent icon button with optional tooltip, badge, and dot indicator support.
 *
 * @example
 * ```tsx
 * // Simple icon button
 * <AIconButton icon={Settings} onClick={handleClick} />
 *
 * // With tooltip
 * <AIconButton icon={MessageSquare} tooltip="Comments" onClick={handleClick} />
 *
 * // With a badge count
 * <AIconButton icon={MessageSquare} tooltip="Messages" badge={5} onClick={handleClick} />
 *
 * // With dot indicator (for active state)
 * <AIconButton icon={Share2} tooltip="Share" dot dotColor="blue" onClick={handleClick} />
 *
 * // Active/selected state
 * <AIconButton icon={MessageSquare} active onClick={handleClick} />
 * ```
 */

"use client";

import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ATooltip } from "@/components/a/ATooltip";
import { cn } from "@/lib/utils";

export type AIconButtonSize = "sm" | "md" | "lg";
export type AIconButtonHighlight =
  | "blue"
  | "green"
  | "red"
  | "orange"
  | "purple";

export interface AIconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  /** Lucide icon component */
  icon: LucideIcon;
  /** Optional tooltip text */
  tooltip?: string;
  /** Optional keyboard shortcut hint for tooltip */
  shortcut?: string;
  /** Tooltip position */
  tooltipSide?: "top" | "right" | "bottom" | "left";
  /** Optional badge count */
  badge?: number;
  /** Show a small dot indicator */
  dot?: boolean;
  /** Dot color (default: "purple") */
  dotColor?: AIconButtonHighlight;
  /** Whether the button is in active/selected state */
  active?: boolean;
  /** Highlight color for the icon */
  highlight?: AIconButtonHighlight;
  /** Button size variant */
  size?: AIconButtonSize;
  /** Button variant */
  variant?: "ghost" | "default" | "muted";
  /** Additional className for the icon */
  iconClassName?: string;
  /** Additional className */
  className?: string;
  /** Accessible label (required if no tooltip) */
  "aria-label"?: string;
}

/* Icon buttons are capsules — a circular target is what a finger expects,
   and it keeps them from reading as tiny windows on a glass bar. */
const SIZE_CLASSES: Record<AIconButtonSize, { button: string; icon: string }> =
  {
    sm: { button: "h-7 w-7", icon: "h-3.5 w-3.5" },
    md: { button: "h-8 w-8", icon: "h-4 w-4" },
    lg: { button: "h-9 w-9", icon: "h-[1.125rem] w-[1.125rem]" },
  };

const VARIANT_CLASSES = {
  ghost: "bg-transparent hover:bg-[var(--fill-4)]",
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  muted: "bg-[var(--fill-3)] hover:bg-[var(--fill-2)]",
};

const HIGHLIGHT_CLASSES: Record<AIconButtonHighlight, string> = {
  blue: "text-status-info hover:text-status-info/80",
  green: "text-status-running hover:text-status-running/80",
  red: "text-status-error hover:text-status-error/80",
  orange: "text-status-waiting hover:text-status-waiting/80",
  purple: "text-primary hover:text-primary/80",
};

const DOT_COLORS: Record<AIconButtonHighlight, string> = {
  blue: "bg-status-info",
  green: "bg-status-running",
  red: "bg-status-error",
  orange: "bg-status-waiting",
  purple: "bg-primary",
};

export const AIconButton = forwardRef<HTMLButtonElement, AIconButtonProps>(
  (
    {
      icon: Icon,
      tooltip,
      shortcut,
      tooltipSide = "bottom",
      badge,
      dot = false,
      dotColor = "purple",
      active = false,
      highlight,
      size = "md",
      variant = "ghost",
      iconClassName,
      className,
      disabled,
      "aria-label": ariaLabel,
      ...props
    },
    ref
  ) => {
    const sizeClasses = SIZE_CLASSES[size];

    const button = (
      <Button
        ref={ref}
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={ariaLabel || tooltip}
        className={cn(
          "relative rounded-full p-0",
          sizeClasses.button,
          active ? VARIANT_CLASSES.default : VARIANT_CLASSES[variant],
          highlight && !active && HIGHLIGHT_CLASSES[highlight],
          disabled && "cursor-not-allowed opacity-40",
          className
        )}
        {...props}
      >
        <Icon className={cn(sizeClasses.icon, iconClassName)} />

        {/* Badge with count */}
        {badge !== undefined && badge > 0 && (
          <Badge
            variant="destructive"
            className="bg-destructive text-destructive-foreground absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[0.625rem] font-semibold tabular-nums"
          >
            {badge > 99 ? "99+" : badge}
          </Badge>
        )}

        {/* Dot indicator */}
        {dot && !badge && (
          <div
            className={cn(
              "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full",
              DOT_COLORS[dotColor]
            )}
          />
        )}
      </Button>
    );

    if (tooltip) {
      return (
        <ATooltip
          content={tooltip}
          shortcut={shortcut}
          side={tooltipSide}
          disabled={disabled}
        >
          {button}
        </ATooltip>
      );
    }

    return button;
  }
);

AIconButton.displayName = "AIconButton";
