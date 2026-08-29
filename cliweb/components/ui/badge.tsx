import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * A badge is a capsule, not a boxed label — and it is set in the system face
 * at caption size. The old all-caps spaced-out mono shouted over the content
 * it was supposed to annotate.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] leading-none font-medium tracking-normal whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-primary/12 text-primary",
        secondary: "bg-[var(--fill-2)] text-muted-foreground",
        destructive: "bg-destructive/12 text-destructive",
        outline: "border border-[var(--fill-1)] text-foreground",
        success: "bg-status-running/14 text-status-running",
        warning: "bg-status-waiting/14 text-status-waiting",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
