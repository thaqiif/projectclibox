export interface Point {
  x: number;
  y: number;
}

export const MIN_MEDIA_ZOOM = 0.2;
export const MAX_MEDIA_ZOOM = 12;

export function clampMediaZoom(zoom: number): number {
  return Math.min(MAX_MEDIA_ZOOM, Math.max(MIN_MEDIA_ZOOM, zoom));
}

/**
 * Reposition a translated image so the same image-space point remains under
 * the cursor after scaling. Offsets and the cursor are relative to the
 * transform origin, in CSS pixels.
 */
export function offsetAfterZoom(
  offset: Point,
  cursor: Point,
  previousZoom: number,
  nextZoom: number
): Point {
  const ratio = nextZoom / previousZoom;
  return {
    x: cursor.x - (cursor.x - offset.x) * ratio,
    y: cursor.y - (cursor.y - offset.y) * ratio,
  };
}
