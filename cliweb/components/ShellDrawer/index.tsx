"use client";

import { useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { X, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDrawerAnimation } from "@/hooks/useDrawerAnimation";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import type { TerminalHandle } from "@/components/Terminal";

const Terminal = dynamic(
  () => import("@/components/Terminal").then((mod) => mod.Terminal),
  { ssr: false }
);

interface ShellDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workingDirectory: string;
}

export function ShellDrawer({
  open,
  onOpenChange,
  workingDirectory,
}: ShellDrawerProps) {
  const terminalRef = useRef<TerminalHandle | null>(null);
  const hasInitialized = useRef(false);
  const { copied, copy } = useCopyToClipboard();

  // Animation
  const isAnimatingIn = useDrawerAnimation(open);

  // When terminal connects, cd to working directory
  const handleConnected = useCallback(() => {
    if (terminalRef.current && workingDirectory && !hasInitialized.current) {
      hasInitialized.current = true;
      // Clear any existing command, cd to directory, and clear screen
      setTimeout(() => {
        terminalRef.current?.sendInput("\x15"); // Ctrl+U to clear line
        setTimeout(() => {
          terminalRef.current?.sendCommand(`cd ${workingDirectory} && clear`);
        }, 50);
      }, 100);
    }
  }, [workingDirectory]);

  // Reset initialization flag when drawer closes
  useEffect(() => {
    if (!open) {
      hasInitialized.current = false;
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "bg-background flex h-full flex-col border-t border-[var(--fill-1)] transition-all duration-200 ease-out",
        isAnimatingIn ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      )}
    >
      {/* Deck header */}
      <div className="glass glass-edge-bottom relative z-10 flex h-10 shrink-0 items-center justify-between gap-1 px-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3">
          <span className="text-primary font-mono text-xs leading-none">
            {">_"}
          </span>
          <span className="ui-label">Shell</span>
          <span className="ui-meta min-w-0 truncate">{workingDirectory}</span>
          <button
            onClick={() => copy(workingDirectory)}
            className="text-muted-foreground hover:text-foreground flex h-5 w-5 shrink-0 items-center justify-center transition-colors"
            title="Copy path"
          >
            {copied ? (
              <Check className="text-status-running h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>
        <button
          onClick={() => onOpenChange(false)}
          className="press focus-ring text-muted-foreground hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-200 hover:bg-[var(--fill-3)]"
          title="Close shell"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Terminal */}
      <div className="flex-1 overflow-hidden">
        <Terminal
          ref={terminalRef}
          onConnected={handleConnected}
          showImageButton={false}
        />
      </div>
    </div>
  );
}
