import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // A field is a recessed well, not an outlined box: a soft fill with a
        // hairline rim, which reads correctly on glass and on solid alike.
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground h-9 w-full min-w-0 rounded-lg border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-1 text-base outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 md:text-sm",
        "transition-[color,background-color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "hover:border-[var(--fill-1)] focus-visible:border-ring/70 focus-visible:bg-transparent focus-visible:ring-[3px] focus-visible:ring-ring/25",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/30",
        className
      )}
      {...props}
    />
  );
}

export { Input };
