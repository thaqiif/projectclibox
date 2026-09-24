"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { MediaViewer } from "@/components/FileExplorer/MediaViewer";
import type { MediaKind } from "@/lib/media-mime";

/** Temporary dev-only probe page for real-browser MediaViewer checks. */
function Probe() {
  const params = useSearchParams();
  const path = params.get("path") ?? "/tmp/sample.png";
  const kind = (params.get("kind") ?? "image") as MediaKind;
  return (
    <div style={{ height: "100dvh", width: "100vw" }}>
      <MediaViewer path={path} kind={kind} fileName={path.split("/").pop()!} />
    </div>
  );
}

export default function MediaProbePage() {
  return (
    <Suspense>
      <Probe />
    </Suspense>
  );
}
