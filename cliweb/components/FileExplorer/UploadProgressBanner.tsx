"use client";

/**
 * UploadProgressBanner: minimal aggregate upload-progress display.
 *
 * Subscribes DIRECTLY to the module-level upload-progress pub/sub in
 * @/lib/file-upload (onUploadProgress / UploadProgress, implemented by
 * the upload agent). It intentionally does NOT touch
 * FileExplorer/index.tsx; wire it where appropriate, e.g.:
 *
 *   // UPLOAD_PROGRESS_INTEGRATION: banner (owned elsewhere)
 *   <UploadProgressBanner className="absolute bottom-2 left-2 right-2" />
 *
 * Renders nothing while no upload is in flight. A single upload at a
 * time is assumed: the pub/sub broadcasts one aggregate UploadProgress.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { onUploadProgress, type UploadProgress } from "@/lib/file-upload";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadProgressBanner({ className }: { className?: string }) {
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  useEffect(() => {
    // The upload path publishes setUploadProgress(null) when the upload
    // finishes or fails, which hides the banner again.
    return onUploadProgress(setProgress);
  }, []);

  if (!progress) return null;

  const total = progress.totalBytes;
  const pct =
    total > 0 ? Math.min(100, Math.floor((progress.bytesSent / total) * 100)) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Uploading ${progress.filename}`}
      className={cn(
        "glass rounded-md border border-border px-3 py-2 text-xs text-foreground shadow-sm",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="truncate font-medium">{progress.filename}</span>
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
          {pct === null
            ? "Uploading..."
            : `${formatBytes(progress.bytesSent)} / ${formatBytes(total)} (${pct}%)`}
        </span>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150"
          style={{ width: pct === null ? "100%" : `${Math.max(pct, 4)}%` }}
        />
      </div>
    </div>
  );
}
