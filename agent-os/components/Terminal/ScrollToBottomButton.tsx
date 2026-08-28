"use client";

import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({
  visible,
  onClick,
}: ScrollToBottomButtonProps) {
  if (!visible) return null;

  return (
    <button
      onClick={onClick}
      className={cn(
        "absolute right-6 bottom-6 z-20",
        "flex h-9 w-9 items-center justify-center rounded-full",
        "glass-thin glass-float text-muted-foreground",
        "press focus-ring hover:text-foreground",
        "lift-in transition-colors duration-200"
      )}
      title="Scroll to bottom"
    >
      <ArrowDown className="h-3.5 w-3.5" />
    </button>
  );
}
