"use client";

import { ShimmeringLoader } from "@/components/ui/skeleton";
import { FolderOpen, GitBranch } from "lucide-react";

export function TerminalSkeleton() {
  return (
    <div className="ambient-canvas flex h-full w-full flex-col items-center justify-center gap-2.5">
      <span className="bg-primary animate-status-pulse h-2 w-2 rounded-full" />
      <span className="text-muted-foreground text-[0.8125rem]">
        Connecting…
      </span>
    </div>
  );
}

export function FileExplorerSkeleton() {
  return (
    <div className="bg-background h-full w-full p-4">
      <div className="mb-4 flex items-center gap-2">
        <FolderOpen className="text-muted-foreground/45 h-4 w-4" />
        <ShimmeringLoader className="h-4 w-32" />
      </div>
      <div className="space-y-2.5 pl-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <ShimmeringLoader className="h-4 w-4" delayIndex={i} />
            <ShimmeringLoader className="h-4 w-24" delayIndex={i} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GitPanelSkeleton() {
  return (
    <div className="bg-background h-full w-full p-4">
      <div className="mb-4 flex items-center gap-2">
        <GitBranch className="text-muted-foreground/45 h-4 w-4" />
        <ShimmeringLoader className="h-4 w-24" />
      </div>
      <div className="space-y-3">
        <ShimmeringLoader className="h-9 w-full rounded-lg" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <ShimmeringLoader className="h-4 w-4" delayIndex={i} />
              <ShimmeringLoader className="h-4 flex-1" delayIndex={i} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
