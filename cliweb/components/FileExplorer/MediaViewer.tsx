"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Download,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaKind } from "@/lib/media-mime";
import {
  clampMediaOffset,
  clampMediaZoom,
  offsetAfterZoom,
} from "@/lib/media-viewer";

export type { MediaKind } from "@/lib/media-mime";

interface MediaViewerProps {
  path: string;
  kind: MediaKind;
  fileName: string;
}

/**
 * Absolute path -> streaming URL. The /api/files/stream route answers Range
 * requests, which is what makes <video>/<audio> seeking work on files that
 * are never fully downloaded.
 */
export function streamUrl(path: string): string {
  return `/api/files/stream?path=${encodeURIComponent(path)}`;
}

/**
 * In-place media viewing: images get pan/zoom, video/audio stream through
 * the Range-capable /api/files/stream endpoint. Self-contained: the native
 * <video>/<audio> controls are used instead of a player dependency.
 */
export function MediaViewer({ path, kind, fileName }: MediaViewerProps) {
  const src = streamUrl(path);

  if (kind === "image") {
    return <ImageViewer key={src} src={src} fileName={fileName} />;
  }
  if (kind === "video") {
    return (
      <StreamingPlayer key={src} src={src} fileName={fileName} kind="video" />
    );
  }
  return (
    <StreamingPlayer key={src} src={src} fileName={fileName} kind="audio" />
  );
}

// ---------------------------------------------------------------------------
// Image viewer: wheel zoom (toward cursor), drag pan, double-click reset,
// zoom buttons. Transform-based so the img itself stays object-fit sized.
// ---------------------------------------------------------------------------

function ImageViewer({ src, fileName }: { src: string; fileName: string }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(false);

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      setZoom((prev) => {
        const next = clampMediaZoom(prev * factor);
        if (next === prev) return prev;
        // Keep the point under the cursor fixed while zooming.
        setOffset((o) => {
          if (cx === undefined || cy === undefined) return o;
          return offsetAfterZoom(o, { x: cx, y: cy }, prev, next);
        });
        return next;
      });
    },
    []
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(factor, cx, cy);
    },
    [zoomAt]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (zoom <= 1) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: offset.x,
        baseY: offset.y,
      };
      setDragging(true);
    },
    [zoom, offset]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const next = {
        x: d.baseX + (e.clientX - d.startX),
        y: d.baseY + (e.clientY - d.startY),
      };
      const image = imageRef.current;
      const container = containerRef.current;
      if (!image || !container) {
        setOffset(next);
        return;
      }
      setOffset(
        clampMediaOffset(
          next,
          { width: image.offsetWidth, height: image.offsetHeight },
          { width: container.clientWidth, height: container.clientHeight },
          zoom
        )
      );
    },
    [zoom]
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  // Removing src aborts an outstanding image fetch when the tab unmounts.
  // This route never creates object URLs, so there is nothing to revoke.
  useEffect(() => {
    const image = imageRef.current;
    return () => image?.removeAttribute("src");
  }, [src]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="glass glass-edge-bottom relative z-10 flex h-11 shrink-0 items-center justify-between px-1 sm:h-8 sm:px-2">
        <span className="ui-label hidden min-w-0 truncate sm:block">{fileName}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconOnlyButton
            label="Zoom out"
            onClick={() => zoomAt(1 / 1.25)}
            icon={<Minus className="h-3 w-3" />}
          />
          <span
            aria-live="polite"
            className="text-muted-foreground ui-meta w-12 text-center tabular-nums"
          >
            {Math.round(zoom * 100)}%
          </span>
          <IconOnlyButton
            label="Zoom in"
            onClick={() => zoomAt(1.25)}
            icon={<Plus className="h-3 w-3" />}
          />
          <IconOnlyButton
            label="Reset view"
            onClick={reset}
            icon={<RotateCcw className="h-3 w-3" />}
          />
          <a
            href={src}
            download={fileName}
            title="Download file"
            aria-label={`Download ${fileName}`}
            className="text-muted-foreground hover:bg-[var(--fill-4)] hover:text-foreground focus-visible:ring-primary flex h-11 w-11 touch-manipulation items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none sm:h-6 sm:w-6"
          >
            <Download className="h-3 w-3" />
          </a>
        </div>
      </div>
      <div
        ref={containerRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={reset}
        style={{ touchAction: zoom > 1 ? "none" : "auto", cursor: dragging ? "grabbing" : zoom > 1 ? "grab" : "default" }}
      >
        {error ? (
          <div role="alert" className="flex flex-col items-center gap-2 p-8">
            <span className="ui-label">Cannot display image</span>
            <span className="ui-meta text-muted-foreground/70">
              the file may have been deleted or uses an unsupported format
            </span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            ref={imageRef}
            src={src}
            alt={fileName}
            draggable={false}
            onError={() => setError(true)}
            className="max-h-full max-w-full select-none rounded-md object-contain will-change-transform"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transformOrigin: "center",
              transition: dragging ? "none" : "transform 0.12s ease-out",
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Video / audio: native controls over the Range-streaming endpoint. Keeping
// the browser's player UI (instead of importing a player library) is a
// deliberate trade-off: reliable, zero new dependencies, and every feature
// (play/pause, seek, volume, mute, fullscreen, time display, PiP) comes for
// free. Range support from the stream route is what makes scrubbing work.
// ---------------------------------------------------------------------------

function StreamingPlayer({
  src,
  fileName,
  kind,
}: {
  src: string;
  fileName: string;
  kind: "video" | "audio";
}) {
  const [error, setError] = useState(false);
  const mediaRef = useRef<HTMLMediaElement>(null);

  const releaseMedia = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.pause();
    media.removeAttribute("src");
    media.load();
  }, []);

  // Explicitly release the native player's connection and decoder resources.
  useEffect(() => releaseMedia, [releaseMedia]);

  const handleError = useCallback(() => {
    releaseMedia();
    setError(true);
  }, [releaseMedia]);

  const media =
    kind === "video" ? (
      <video
        key={src}
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        src={src}
        aria-label={`${fileName} video player`}
        controls
        preload="metadata"
        playsInline
        className="max-h-full max-w-full rounded-md bg-black object-contain"
        onError={handleError}
      />
    ) : (
      <audio
        key={src}
        ref={mediaRef as React.RefObject<HTMLAudioElement>}
        src={src}
        aria-label={`${fileName} audio player`}
        controls
        preload="metadata"
        className="w-full max-w-md"
        onError={handleError}
      />
    );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="glass glass-edge-bottom relative z-10 flex h-11 shrink-0 items-center justify-between px-1 sm:h-8 sm:px-2">
        <span className="ui-label min-w-0 truncate">{fileName}</span>
        <a
          href={src}
          download={fileName}
          title="Download file"
          aria-label={`Download ${fileName}`}
          className="text-muted-foreground hover:bg-[var(--fill-4)] hover:text-foreground focus-visible:ring-primary flex h-11 w-11 touch-manipulation items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none sm:h-6 sm:w-6"
        >
          <Download className="h-3 w-3" />
        </a>
      </div>
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4",
          kind === "audio" && "px-2 sm:px-6"
        )}
      >
        {error ? (
          <div role="alert" className="flex flex-col items-center gap-2">
            <Maximize2 className="text-muted-foreground/50 h-5 w-5" />
            <span className="ui-label">Cannot play media</span>
            <span className="ui-meta text-muted-foreground/70">
              the file may have been deleted or the browser does not support it
            </span>
          </div>
        ) : (
          media
        )}
      </div>
    </div>
  );
}

function IconOnlyButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="text-muted-foreground hover:bg-[var(--fill-4)] hover:text-foreground focus-visible:ring-primary flex h-11 w-11 touch-manipulation items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none sm:h-6 sm:w-6"
    >
      {icon}
    </button>
  );
}
