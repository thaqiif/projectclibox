"use client";

import { useEffect, useState } from "react";
import {
  onUploadProgress,
  type UploadProgress,
} from "@/lib/file-upload";

/**
 * Subscribe to aggregate file-upload progress.
 *
 * The upload pipeline (cliweb/lib/file-upload.ts) publishes progress to a
 * module-level pub/sub on every confirmed chunk; this hook mirrors the
 * latest update into React state, so any component can render a progress
 * bar without prop drilling or touching the upload call sites.
 *
 * Usage:
 *
 *   const { uploading, progressPct, filename } = useFileUploadProgress();
 *
 *   return uploading ? (
 *     <div>
 *       Uploading {filename}: {progressPct}%
 *       <progress value={progressPct} max={100} />
 *     </div>
 *   ) : null;
 *
 * `progressPct` is an integer 0..99 while uploading and exactly 100 for
 * the instant the final chunk is confirmed (before the subscription
 * clears). Percentage is byte-based (server-confirmed bytes), not
 * chunk-count based.
 */
export function useFileUploadProgress(): {
  /** True while at least one upload is in flight. */
  uploading: boolean;
  /** Integer 0..100; 0 when idle. */
  progressPct: number;
  /** Name of the file currently being uploaded, or null when idle. */
  filename: string | null;
} {
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  useEffect(() => {
    // The upload path fires setUploadProgress(null) when it finishes or
    // fails, which flips `uploading` back to false here.
    return onUploadProgress(setProgress);
  }, []);

  const uploading = progress !== null;
  const progressPct =
    progress && progress.totalBytes > 0
      ? Math.min(
          100,
          Math.floor((progress.bytesSent / progress.totalBytes) * 100)
        )
      : 0;

  return { uploading, progressPct, filename: progress?.filename ?? null };
}
