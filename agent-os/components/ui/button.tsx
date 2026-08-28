import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Buttons are controls, so they live in the glass layer — but restraint
 * matters: only the tinted and glass variants actually carry material.
 * Plain and ghost buttons are fills over whatever is behind them, which is
 * how Apple keeps a toolbar from turning into a wall of little windows.
 *
 * Every variant responds on pointer-*down* via `.press`, never only on
 * release.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "rounded-lg border border-transparent text-[0.8125rem] font-medium",
    "press focus-ring outline-none select-none",
    "disabled:pointer-events-none disabled:opacity-40",
    "aria-invalid:border-destructive",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        /** The one filled control in a view. Solid, so it reads as the answer. */
        default:
          "bg-primary text-primary-foreground shadow-[var(--elev-1)] hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[var(--elev-1)] hover:bg-destructive/90",
        /** Glass: a control that floats over content it does not own. */
        outline:
          "glass-thin text-foreground rounded-lg hover:bg-[var(--fill-3)]",
        /** A fill, not a material — safe to sit on top of glass. */
        secondary:
          "bg-[var(--fill-3)] text-foreground hover:bg-[var(--fill-2)]",
        ghost:
          "text-muted-foreground hover:bg-[var(--fill-4)] hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-11 px-6 text-[0.9375rem] has-[>svg]:px-5",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
