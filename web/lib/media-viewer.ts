export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
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

/**
 * Keep a dragged image reachable: the pan is capped so at least
 * `minVisible` of the container stays covered by the (scaled) image, which
 * stops a large image being dragged entirely out of view. `fitted` is the
 * untransformed layout size of the image, `container` the viewport size.
 */
export function clampMediaOffset(
  offset: Point,
  fitted: Size,
  container: Size,
  zoom: number,
  minVisible = 0.25
): Point {
  const limit = (scaled: number, viewport: number) =>
    Math.max(0, (scaled + viewport) / 2 - minVisible * viewport);
  const limitX = limit(fitted.width * zoom, container.width);
  const limitY = limit(fitted.height * zoom, container.height);
  return {
    x: Math.min(limitX, Math.max(-limitX, offset.x)),
    y: Math.min(limitY, Math.max(-limitY, offset.y)),
  };
}
