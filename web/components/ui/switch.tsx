"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer focus-ring data-[state=checked]:bg-primary inline-flex h-[1.375rem] w-[2.375rem] shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-[var(--fill-1)] p-0.5 outline-none transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[1.125rem] rounded-full bg-white shadow-[var(--elev-1)] ring-0 transition-transform duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-[state=checked]:translate-x-[1rem] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
