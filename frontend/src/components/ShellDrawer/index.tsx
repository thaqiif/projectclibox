"use client";

import { useRef, useEffect, useState } from "react";
import dynamic from "@/lib/dynamic";
import { X, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDrawerAnimation } from "@/hooks/useDrawerAnimation";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { api } from "@/api";
import { TerminalSkeleton } from "@/components/Pane/PaneSkeletons";

const Terminal = dynamic(
  () => import("@/components/Terminal").then((mod) => mod.Terminal),
  { ssr: false, loading: () => <TerminalSkeleton /> }
);

interface ShellDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workingDirectory: string;
  projectId?: string;
}

export function ShellDrawer({
  open,
  onOpenChange,
  workingDirectory,
  projectId,
}: ShellDrawerProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const { copied, copy } = useCopyToClipboard();

  // Animation
  const isAnimatingIn = useDrawerAnimation(open);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    sessionIdRef.current = null;
    setSessionId(null);
    void api
      .createSession({ cwd: workingDirectory, projectId })
      .then((session) => {
        if (cancelled) {
          void api
            .terminate(session.id)
            .then(() => api.deleteMetadata(session.id))
            .catch(() => undefined);
          return;
        }
        sessionIdRef.current = session.id;
        setSessionId(session.id);
      })
      .catch((error) => {
        console.error("Failed to create shell session:", error);
      });

    return () => {
      cancelled = true;
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      setSessionId(null);
      if (id) {
        void api
          .terminate(id)
          .then(() => api.deleteMetadata(id))
          .catch(() => undefined);
      }
    };
  }, [open, projectId, workingDirectory]);

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

      {/* Direct PTY session */}
      <div className="flex-1 overflow-hidden">
        {sessionId ? (
          <Terminal sessionId={sessionId} showImageButton={false} />
        ) : (
          <TerminalSkeleton />
        )}
      </div>
    </div>
  );
}
