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
  type Point,
  type Size,
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
// Image viewer: wheel and pinch zoom, drag pan, double-click reset, zoom
// buttons. Transform-based so the img itself stays object-fit sized.
// ---------------------------------------------------------------------------

function ImageViewer({ src, fileName }: { src: string; fileName: string }) {
  // One state object keeps every update pure: React may invoke an updater
  // twice (StrictMode), and a second setState inside an updater would then
  // apply twice, which is what made wheel zoom double-apply its pan.
  const [view, setView] = useState<{ zoom: number; offset: Point }>({
    zoom: 1,
    offset: { x: 0, y: 0 },
  });
  const { zoom, offset } = view;
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * Layout sizes captured in event handlers, so the state updaters below stay
   * pure (no DOM reads while React may replay them).
   */
  const layoutRef = useRef<{ fitted: Size; container: Size } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const touchPointsRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{
    pointerIds: [number, number];
    startDistance: number;
    startZoom: number;
    startOffset: Point;
    startCenter: Point;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(false);

  /**
   * React's own onError can miss a failure that the browser reports before the
   * handler is attached (a 404 arrives fast, the element is already
   * `complete` with naturalWidth 0). Attach a native listener at commit time
   * and re-check completeness, so a deleted file always reaches the error UI.
   */
  const attachImage = useCallback((element: HTMLImageElement | null) => {
    imageRef.current = element;
    if (!element) return () => undefined as unknown as void;
    // A fast failure (local 404) can complete before React ever attaches the
    // element's handler, so the commit is the last reliable checkpoint.
    if (element.complete && element.naturalWidth === 0) {
      setError(true);
      return () => undefined as unknown as void;
    }
    const onError = () => setError(true);
    element.addEventListener("error", onError);
    return () => element.removeEventListener("error", onError);
  }, []);

  const measure = useCallback(() => {
    const image = imageRef.current;
    const container = containerRef.current;
    layoutRef.current =
      image && container
        ? {
            // offsetWidth/Height are layout sizes, unaffected by the transform.
            fitted: { width: image.offsetWidth, height: image.offsetHeight },
            container: {
              width: container.clientWidth,
              height: container.clientHeight,
            },
          }
        : null;
  }, []);

  const clamp = useCallback((offset: Point, zoom: number): Point => {
    const layout = layoutRef.current;
    if (!layout) return offset;
    return clampMediaOffset(offset, layout.fitted, layout.container, zoom);
  }, []);

  const reset = useCallback(() => {
    setView({ zoom: 1, offset: { x: 0, y: 0 } });
  }, []);

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      measure();
      setView((prev) => {
        const next = clampMediaZoom(prev.zoom * factor);
        if (next === prev.zoom) return prev;
        const moved =
          cx === undefined || cy === undefined
            ? prev.offset
            : // Keep the point under the cursor fixed while zooming.
              offsetAfterZoom(prev.offset, { x: cx, y: cy }, prev.zoom, next);
        return { zoom: next, offset: clamp(moved, next) };
      });
    },
    [clamp, measure]
  );

  const pointInContainer = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2,
    };
  }, []);

  const startPinch = useCallback(() => {
    const points = Array.from(touchPointsRef.current.entries());
    if (points.length !== 2) return;
    const [[firstId, first], [secondId, second]] = points;
    measure();
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    pinchRef.current = {
      pointerIds: [firstId, secondId],
      startDistance: Math.hypot(dx, dy),
      startZoom: view.zoom,
      startOffset: view.offset,
      startCenter: pointInContainer(
        (first.x + second.x) / 2,
        (first.y + second.y) / 2
      ),
    };
    dragRef.current = null;
    setDragging(true);
  }, [measure, pointInContainer, view.offset, view.zoom]);

  // React attaches wheel listeners passively, so preventDefault inside onWheel
  // is ignored (the page scrolls). A native non-passive listener is required.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(
        e.deltaY < 0 ? 1.15 : 1 / 1.15,
        e.clientX - rect.left - rect.width / 2,
        e.clientY - rect.top - rect.height / 2
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      if (e.pointerType === "touch") {
        touchPointsRef.current.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
        });
        if (touchPointsRef.current.size >= 2) {
          startPinch();
          return;
        }
      }

      if (zoom <= 1) return;
      measure();
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: offset.x,
        baseY: offset.y,
      };
      setDragging(true);
    },
    [measure, startPinch, zoom, offset]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "touch" && touchPointsRef.current.has(e.pointerId)) {
        touchPointsRef.current.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
        });
      }

      const pinch = pinchRef.current;
      if (pinch && pinch.pointerIds.includes(e.pointerId)) {
        const first = touchPointsRef.current.get(pinch.pointerIds[0]);
        const second = touchPointsRef.current.get(pinch.pointerIds[1]);
        if (!first || !second) return;
        const currentDistance = Math.hypot(second.x - first.x, second.y - first.y);
        const currentCenter = pointInContainer(
          (first.x + second.x) / 2,
          (first.y + second.y) / 2
        );
        const nextZoom = clampMediaZoom(
          pinch.startZoom * (currentDistance / Math.max(1, pinch.startDistance))
        );
        const zoomedOffset = offsetAfterZoom(
          pinch.startOffset,
          pinch.startCenter,
          pinch.startZoom,
          nextZoom
        );
        const nextOffset = {
          x: zoomedOffset.x + currentCenter.x - pinch.startCenter.x,
          y: zoomedOffset.y + currentCenter.y - pinch.startCenter.y,
        };
        setView({ zoom: nextZoom, offset: clamp(nextOffset, nextZoom) });
        return;
      }

      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const next = {
        x: d.baseX + (e.clientX - d.startX),
        y: d.baseY + (e.clientY - d.startY),
      };
      setView((prev) => ({ ...prev, offset: clamp(next, prev.zoom) }));
    },
    [clamp, pointInContainer]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "touch") {
        touchPointsRef.current.delete(e.pointerId);
      }

      const pinch = pinchRef.current;
      if (pinch?.pointerIds.includes(e.pointerId)) {
        pinchRef.current = null;
        const remaining = Array.from(touchPointsRef.current.entries());
        if (remaining.length === 2) {
          startPinch();
          return;
        }
        if (remaining.length === 1 && zoom > 1) {
          const [pointerId, point] = remaining[0];
          dragRef.current = {
            pointerId,
            startX: point.x,
            startY: point.y,
            baseX: view.offset.x,
            baseY: view.offset.y,
          };
          setDragging(true);
          return;
        }
      }

      if (!dragRef.current || dragRef.current.pointerId === e.pointerId) {
        dragRef.current = null;
        setDragging(false);
      }
    },
    [startPinch, view.offset, zoom]
  );

  // Keyboard alternative to the mouse gestures: arrows pan, +/- zoom, 0 resets.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = 40;
      const pans: Record<string, Point> = {
        ArrowLeft: { x: step, y: 0 },
        ArrowRight: { x: -step, y: 0 },
        ArrowUp: { x: 0, y: step },
        ArrowDown: { x: 0, y: -step },
      };
      if (e.key in pans) {
        if (zoom <= 1) return;
        e.preventDefault();
        measure();
        setView((prev) => {
          const delta = pans[e.key];
          const next = {
            x: prev.offset.x + delta.x,
            y: prev.offset.y + delta.y,
          };
          return { ...prev, offset: clamp(next, prev.zoom) };
        });
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomAt(1.25);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomAt(1 / 1.25);
      } else if (e.key === "0") {
        e.preventDefault();
        reset();
      }
    },
    [clamp, measure, reset, zoom, zoomAt]
  );

  // No cleanup is needed for the image: unmounting removes the element, which
  // aborts an in-flight request, and this viewer never creates object URLs.
  // Clearing src here would be actively wrong, because React re-runs effects
  // on mount in development (StrictMode) without re-applying unchanged props,
  // leaving the image with no source at all.

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col">
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
            className="text-muted-foreground hover:bg-[var(--fill-4)] hover:text-foreground focus-visible:ring-primary flex h-11 w-11 touch-manipulation items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none sm:h-7 sm:w-7 pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <Download className="h-3 w-3" />
          </a>
        </div>
      </div>
      <div
        ref={containerRef}
        tabIndex={0}
        role="group"
        aria-label={`${fileName} image preview. Pinch or use plus and minus to zoom, drag or use arrow keys to pan, zero resets.`}
        className="focus-visible:ring-primary relative flex min-h-0 min-w-0 w-full flex-1 items-center justify-center overflow-hidden focus-visible:ring-2 focus-visible:outline-none"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={reset}
        style={{ touchAction: "none", cursor: dragging ? "grabbing" : zoom > 1 ? "grab" : "default" }}
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
            ref={attachImage}
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
  const mediaRef = useRef<HTMLMediaElement>(null);
  const [error, setError] = useState(false);

  /**
   * Same reasoning as the image viewer: a fast 404 can beat React's own
   * onError, so also listen natively from the moment the element exists.
   */
  const attachMedia = useCallback((element: HTMLMediaElement | null) => {
    const previous = mediaRef.current;
    mediaRef.current = element;
    if (!element) return;
    if (element !== previous) {
      // A fresh element belongs to a new src (the element is keyed by src), so
      // the previous failure no longer describes it. Drop it, unless this very
      // element already failed.
      setError(element.error === null ? false : true);
      element.addEventListener("error", () => setError(true));
      return;
    }
    // Same element (StrictMode re-attach): keep existing state and listener.
    element.addEventListener("error", () => setError(true));
  }, []);

  const media =
    kind === "video" ? (
      <video
        key={src}
        ref={attachMedia as React.Ref<HTMLVideoElement>}
        src={src}
        aria-label={`${fileName} video player`}
        controls
        preload="metadata"
        playsInline
        className="max-h-full min-w-0 w-full max-w-full rounded-md bg-black object-contain"
        onError={() => setError(true)}
      />
    ) : (
      <audio
        key={src}
        ref={attachMedia as React.Ref<HTMLAudioElement>}
        src={src}
        aria-label={`${fileName} audio player`}
        controls
        preload="metadata"
        className="w-full max-w-full"
        onError={() => setError(true)}
      />
    );

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col">
      <div className="glass glass-edge-bottom relative z-10 flex h-11 shrink-0 items-center justify-between px-1 sm:h-8 sm:px-2">
        <span className="ui-label min-w-0 truncate">{fileName}</span>
        <a
          href={src}
          download={fileName}
          title="Download file"
          aria-label={`Download ${fileName}`}
            className="text-muted-foreground hover:bg-[var(--fill-4)] hover:text-foreground focus-visible:ring-primary flex h-11 w-11 touch-manipulation items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none sm:h-7 sm:w-7 pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <Download className="h-3 w-3" />
        </a>
      </div>
      <div
        className={cn(
          "flex min-h-0 min-w-0 w-full flex-1 items-center justify-center p-2 sm:p-4",
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
      className="text-muted-foreground hover:bg-[var(--fill-4)] hover:text-foreground focus-visible:ring-primary flex h-11 w-11 touch-manipulation items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none sm:h-7 sm:w-7 pointer-coarse:h-11 pointer-coarse:w-11"
    >
      {icon}
    </button>
  );
}
