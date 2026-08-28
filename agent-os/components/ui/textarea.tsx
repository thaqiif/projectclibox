import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground w-full min-w-0 rounded-lg border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 text-base outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 md:text-sm",
        "transition-[color,background-color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "hover:border-[var(--fill-1)] focus-visible:border-ring/70 focus-visible:bg-transparent focus-visible:ring-[3px] focus-visible:ring-ring/25",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/30",
        "min-h-[80px] resize-y",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
