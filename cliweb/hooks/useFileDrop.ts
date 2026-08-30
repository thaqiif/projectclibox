"use client";

import { useState, useCallback, useEffect, type RefObject } from "react";

interface UseFileDropOptions {
  /** Disable drop handling (e.g., while uploading) */
  disabled?: boolean;
}

interface DragHandlers {
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

const TERMINAL_DRAG_TYPE = "application/x-cliweb-terminal";
const PANE_DRAG_TYPE = "application/x-cliweb-monitor-pane";

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
 * @param onFileDrop - Callback when a file is dropped
 * @param options - Optional configuration
 * @returns isDragging state and drag event handlers to spread onto the container
 */
export function useFileDrop(
  containerRef: RefObject<HTMLElement | null>,
  onFileDrop: (file: File) => void,
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
      e.preventDefault();
      e.stopPropagation();
      if (!options?.disabled) {
        setIsDragging(true);
      }
    },
    [options?.disabled]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (isMonitorDrag(e)) return;
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
    (e: React.DragEvent) => {
      if (isMonitorDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (options?.disabled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onFileDrop(files[0]);
      }
    },
    [onFileDrop, options?.disabled]
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
