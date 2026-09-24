"use client";

import { MediaViewer } from "@/components/FileExplorer/MediaViewer";

/**
 * Temporary dev-only probe page used to verify MediaViewer behavior in a real
 * browser (zoom math under StrictMode, layout, keyboard pan). Not shipped.
 */
export default function MediaProbePage() {
  return (
    <div style={{ height: "100dvh", width: "100vw" }}>
      <MediaViewer path="/tmp/sample.png" kind="image" fileName="sample.png" />
    </div>
  );
}
