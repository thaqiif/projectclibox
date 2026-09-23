"use client";

import { useState, useCallback, useEffect, type RefObject } from "react";
import { toast } from "sonner";
import {
  PANE_DRAG_TYPE,
  TERMINAL_DRAG_TYPE,
} from "@/lib/drag-types";

interface UseFileDropOptions {
  /** Disable drop handling (e.g., while uploading) */
  disabled?: boolean;
  /**
   * Per-event gate. When it returns false the hook ignores the drag
   * entirely (no preventDefault, no highlight, no drop), leaving the event
   * for other handlers. Used to accept only OS file drags where a
   * container also hosts internal element drags (e.g. row moves in the
   * file listing).
   */
  enabled?: (e: React.DragEvent) => boolean;
}

interface DragHandlers {
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function isMonitorDrag(event: React.DragEvent) {
  const types = Array.from(event.dataTransfer.types);
  return (
    types.includes(TERMINAL_DRAG_TYPE) || types.includes(PANE_DRAG_TYPE)
  );
}

/**
 * Hook for handling file drag and drop on a container element.
 *
 * @param containerRef - Ref to the container element for relatedTarget checking
 * @param onFileDrop - Async callback invoked once per dropped file, in drop
 *   order; a rejection is collected and does not stop later files
 * @param options - Optional configuration
 * @returns isDragging state and drag event handlers to spread onto the container
 */
export function useFileDrop(
  containerRef: RefObject<HTMLElement | null>,
  onFileDrop: (file: File) => void | Promise<void>,
  options?: UseFileDropOptions
): { isDragging: boolean; dragHandlers: DragHandlers } {
  const [isDragging, setIsDragging] = useState(false);

  // Reset drag state when disabled
  useEffect(() => {
    if (!options?.disabled) return;

    const frame = requestAnimationFrame(() => setIsDragging(false));
    return () => cancelAnimationFrame(frame);
  }, [options?.disabled]);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      // Monitor pane drops use a custom MIME type. Let those events bubble so
      // an occupied pane can still receive a replacement terminal.
      if (isMonitorDrag(e)) return;
      if (options?.enabled && !options.enabled(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!options?.disabled) {
        setIsDragging(true);
      }
    },
    [options?.disabled, options?.enabled]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (isMonitorDrag(e)) return;
      if (options?.enabled && !options.enabled(e)) return;
      e.preventDefault();
      e.stopPropagation();
      // Only clear when the pointer leaves the container entirely, so moving
      // across nested elements does not flicker the overlay.
      if (!containerRef.current?.contains(e.relatedTarget as Node)) {
        setIsDragging(false);
      }
    },
    [containerRef]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (isMonitorDrag(e)) return;
      if (options?.enabled && !options.enabled(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (options?.disabled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      // Process every dropped file, one at a time, so uploads land in a
      // predictable order and cannot pile up on shared upload state. Each
      // file's failure is collected so one bad file never aborts the rest.
      const errors: { file: File; error: unknown }[] = [];
      for (const file of files) {
        try {
          await onFileDrop(file);
        } catch (error) {
          errors.push({ file, error });
        }
      }

      if (errors.length > 0) {
        toast.error(
          `Failed to upload ${errors.length} of ${files.length} file(s)`,
          {
            description: errors
              .map(
                ({ file, error }) =>
                  `${file.name}: ${
                    error instanceof Error ? error.message : String(error)
                  }`
              )
              .join("\n"),
          }
        );
      }
    },
    [onFileDrop, options?.disabled, options?.enabled]
  );

  return {
    isDragging,
    dragHandlers: {
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
