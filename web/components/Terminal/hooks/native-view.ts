"use client";

import { MOMENTUM_STOP_VELOCITY, MOMENTUM_TIME_CONSTANT_MS } from "./momentum";
import type { NativeScrollTarget } from "./native-panes";
import { detectPaneShift } from "./tui-pan";

/**
 * Touch scrolling of an app's native pane (jcode's chat), drawn locally.
 *
 * Each row the app shows costs a round trip. Chained to those arrivals, a
 * fling on a real network moves at the app's pace and keeps going after the
 * finger stops while late rows trickle in. Instead, while a gesture runs,
 * the pane is drawn here from a cache of rows at exactly the finger's (or
 * the glide's) position, like a native list:
 *
 * - Redraws that read as a scroll are cached by position in the content,
 *   so rows the view has passed stay available behind it. Apps that do not
 *   use synchronized output are often caught half drawn, so only rows that
 *   two frames in a row agree on are cached, and a screen that could not
 *   be followed is believed once it stops changing.
 * - Requests run ahead of the finger in proportion to its speed, so the
 *   rows it is about to reach are usually already drawn.
 * - When the view comes to rest, the app is asked to land exactly there;
 *   once the real screen shows the same rows, the overlay goes away with
 *   nothing to see.
 *
 * Content positions are counted in rows, older = smaller. `paneTop` is the
 * position of the pane's first row on screen; rows the app pins (jcode's
 * question header) are not part of the scroll and are never covered.
 */

export interface NativeView {
  /** Finger travel in px; positive (finger down) reveals older rows. */
  move(fingerDeltaY: number): void;
  /** Release with momentum (px/ms, 0 for none). */
  fling(velocity: number): void;
  /** A new touch landed: stop gliding, keep the view. */
  stop(): void;
  dispose(): void;
}

// Rows asked for ahead of the finger per px/ms of its speed, and at most.
const LOOKAHEAD_MS = 220;
const MAX_LOOKAHEAD_ROWS = 20;
// jcode drops queued scroll beyond 30 rows.
const MAX_QUEUED_ROWS = 24;
const SNAP_TIME_CONSTANT_MS = 45;
// The shortest glide, for a flick stopped early by the end of the content.
const MIN_GLIDE_MS = 150;
// A screen that has not changed for this long shows the app's last frame.
const QUIET_MS = 120;
// Quiet periods a half-drawn-looking screen must last to be believed.
const TORN_QUIET_CHECKS = 5;
// A redraw is read once the screen has not changed for this long.
const SETTLE_MS = 10;
// How far from the app's reported position a screen is looked for.
const LOCATE_RADIUS = 8;
// Give up waiting for the app to land after this long.
const LAND_TIMEOUT_MS = 2500;
const MAX_CORRECTIONS = 3;
// Characters of a line compared when looking for a half-drawn frame.
const TORN_PREFIX = 16;
// A line with this many visible characters is not expected to repeat.
const DISTINCTIVE_CHARS = 8;

// Rows kept per terminal between gestures, so scrolling back over them is
// instant too; dropped when the pane's content or size changes.
const MAX_CACHED_ROWS = 4000;

interface CachedRow {
  html: string;
  background: string;
  /** The row's text as compared between frames. */
  text: string;
}

interface RowCache {
  signature: string;
  rows: Map<number, CachedRow>;
}

const views = new WeakMap<HTMLElement, NativeView>();
const cacheByElement = new WeakMap<HTMLElement, RowCache>();
// Rows each pane was last seen to pin, so the next gesture starts right.
const pinnedByElement = new WeakMap<
  HTMLElement,
  { top: number; bottom: number }
>();

export function nativeViewFor(element: HTMLElement): NativeView | null {
  return views.get(element) ?? null;
}

export function closeNativeView(element: HTMLElement): void {
  views.get(element)?.dispose();
}

/**
 * A screen showing the same run of lines twice: a redraw the app has not
 * finished (rows scrolled in still show the rows they came from, perhaps
 * partly overwritten, so lines are compared by how they start). Real
 * content rarely repeats two lines in a row; if it does, the frame is only
 * skipped.
 */
export function looksTorn(
  frame: readonly string[],
  from: number,
  to: number
): boolean {
  const lines: number[] = [];
  for (let r = from; r < to; r += 1) if (frame[r].trim() !== "") lines.push(r);
  const seen = new Map<string, number>();
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const start = (r: number) => frame[r].trim().slice(0, TORN_PREFIX);
    const pair = `${start(lines[i])}\n${start(lines[i + 1])}`;
    const at = seen.get(pair);
    if (at !== undefined && at !== i) return true;
    seen.set(pair, i);
  }
  return false;
}

const distinctive = (line: string) =>
  line.replace(/\s/g, "").length >= DISTINCTIVE_CHARS;

export function openNativeView(
  element: HTMLElement,
  pane: NativeScrollTarget,
  rowHeight: number,
  options: {
    requestFrame?: (callback: (time: number) => void) => number;
    cancelFrame?: (handle: number) => void;
    now?: () => number;
    /** Screen width of a column in px; places the view over the pane. */
    columnWidth?: number;
  } = {}
): NativeView | null {
  const grid = element.querySelector<HTMLElement>(".term-grid");
  if (!grid || rowHeight <= 0) return null;
  views.get(element)?.dispose();
  const requestFrame =
    options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  const now = options.now ?? (() => performance.now());

  const height = pane.bottom - pane.top + 1;
  const remembered = pinnedByElement.get(element);
  const pinned = { ...(remembered ?? { top: 0, bottom: 0 }) };
  let pinnedKnown = remembered !== undefined;
  const rowElements = () =>
    Array.from(
      grid.querySelectorAll<HTMLElement>(
        ":scope > .term-row:not(.term-scrollback-row)"
      )
    ).slice(pane.top, pane.bottom + 1);
  // The pane's text for comparing frames, less its last column (the app's
  // scrollbar, whose thumb moves as it scrolls).
  const readCells = () =>
    rowElements().map((row) =>
      (row.textContent ?? "").slice(pane.left, pane.right)
    );

  const initialLimits = pane.limits();
  if (!initialLimits) return null;
  // Content rows are cached by their absolute position in the app's content
  // (rows from its top), which is the marked position plus a view position.
  const base = initialLimits.older;
  const signature = `${pane.top}:${pane.bottom}:${pane.left}:${pane.right}:${
    initialLimits.older + initialLimits.newer
  }:${grid.clientWidth}`;
  let stored = cacheByElement.get(element);
  if (!stored || stored.signature !== signature) {
    stored = { signature, rows: new Map() };
    cacheByElement.set(element, stored);
  }
  const cache = stored.rows;
  // The screen as it was when the view opened, or once it has stayed the
  // same for a while: shown where nothing confirmed is cached yet.
  let screen = new Map<number, CachedRow>();
  const cached = (position: number) =>
    cache.get(base + position) ?? screen.get(base + position);
  let paneTop = 0; // content position of the pane's first row on screen
  let viewTop = 0; // content position the view shows there (fractional)
  let cells = readCells();
  let requested = 0; // rows asked for since mark(), older = positive
  let velocity = 0; // px/ms of the view, older = positive
  let lastMoveAt = now();
  let frame: number | null = null;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  // A quiet screen that contradicted the cache, waiting to be seen again.
  let quietText: string | null = null;
  let quietChecks = 0;
  let landingSince: number | null = null;
  let corrections = 0;
  // Rows the app is asked to move beyond the view's own position, when its
  // position and its screen differ.
  let appOffset = 0;
  let disposed = false;
  pane.mark();

  /** Cached rows that read differently from `frame` shown from `top`. */
  const conflicts = (
    top: number,
    frame: readonly string[],
    from: number,
    to: number
  ) => {
    let count = 0;
    for (let r = from; r < to; r += 1) {
      const previous = cache.get(base + top + r);
      if (previous && previous.text !== frame[r] && frame[r].trim() !== "") {
        count += 1;
      }
    }
    return count;
  };

  /**
   * Where a screen that could not be followed row by row sits, found by
   * matching it against rows already seen near `hint` (the app's reported
   * position, which can be a few rows off the screen's while the app pins
   * a header). Without a clear match, the hint.
   */
  const locate = (frame: readonly string[], hint: number) => {
    const from = pinned.top;
    const to = frame.length - pinned.bottom;
    const counts = new Map<string, number>();
    for (const line of frame) counts.set(line, (counts.get(line) ?? 0) + 1);
    let best = hint;
    let bestMatches = 1;
    for (let distance = 0; distance <= LOCATE_RADIUS; distance += 1) {
      for (const top of distance === 0
        ? [hint]
        : [hint - distance, hint + distance]) {
        let matches = 0;
        let clash = false;
        for (let r = from; r < to && !clash; r += 1) {
          const previous = cache.get(base + top + r);
          if (!previous || frame[r].trim() === "") continue;
          if (previous.text !== frame[r]) clash = true;
          else if (counts.get(frame[r]) === 1) matches += 1;
        }
        // Nearest wins a tie.
        if (!clash && matches > bestMatches) {
          best = top;
          bestMatches = matches;
        }
      }
    }
    return best;
  };

  /** Take the screen as read (`cells`, at `paneTop`) as the one to show. */

  const showScreen = () => {
    const rows = rowElements();
    screen = new Map();
    for (let r = pinned.top; r < rows.length - pinned.bottom; r += 1) {
      screen.set(base + paneTop + r, {
        html: rows[r].innerHTML,
        background: rows[r].style.background,
        text: cells[r],
      });
    }
  };

  /**
   * Cache the screen's rows from `from` to `to`, which two frames in a row
   * agree on. Rows cached there that read differently were content that
   * has since changed: nothing else cached can be trusted either.
   */
  const remember = (from = pinned.top, to = cells.length - pinned.bottom) => {
    const rows = rowElements();
    if (conflicts(paneTop, cells, from, to) >= 2) cache.clear();
    // The app can leave a line drawn twice for a moment (a redraw it fixes
    // shortly after). A distinctive line shown twice is kept only where it
    // is already known to be.
    const count = new Map<string, number>();
    for (let r = from; r < to; r += 1) {
      if (distinctive(cells[r]))
        count.set(cells[r], (count.get(cells[r]) ?? 0) + 1);
    }
    for (let r = from; r < to; r += 1) {
      const key = base + paneTop + r;
      if ((count.get(cells[r]) ?? 0) > 1 && cache.get(key)?.text !== cells[r]) {
        continue;
      }
      cache.delete(key);
      cache.set(key, {
        html: rows[r].innerHTML,
        background: rows[r].style.background,
        text: cells[r],
      });
    }
    // Oldest insertions first: drop those beyond the limit.
    for (const key of cache.keys()) {
      if (cache.size <= MAX_CACHED_ROWS) break;
      cache.delete(key);
    }
  };
  paneTop = locate(cells, 0);
  viewTop = paneTop;
  appOffset = paneTop;
  showScreen();

  const overlay = element.ownerDocument.createElement("div");
  overlay.className = "native-view";
  const layer = element.ownerDocument.createElement("div");
  layer.className = "native-rows";
  overlay.appendChild(layer);
  element.appendChild(overlay);
  const shown = new Map<number, HTMLElement>();
  const spare: HTMLElement[] = [];
  // What each row element currently shows.
  const drawn = new WeakMap<HTMLElement, string>();

  // Only the pane's own columns are covered, so a neighbouring pane stays
  // live; the layer holds whole rows, shifted to line up with the grid.
  const columnWidth = options.columnWidth ?? 0;
  const left = columnWidth > 0 ? pane.left * columnWidth : 0;
  // Reading the grid's geometry forces a layout, so it is read once; only
  // the pinned rows (learned from redraws) change where the view sits.
  const gridTop = grid.offsetTop;
  const gridLeft = grid.offsetLeft;
  const gridWidth = grid.clientWidth;
  let placed = "";
  const place = () => {
    const key = `${pinned.top}:${pinned.bottom}`;
    if (key === placed) return;
    placed = key;
    const top = pane.top + pinned.top;
    const rows = height - pinned.top - pinned.bottom;
    const width =
      columnWidth > 0
        ? Math.min(gridWidth - left, (pane.right - pane.left + 1) * columnWidth)
        : gridWidth;
    overlay.style.top = `${gridTop + top * rowHeight}px`;
    overlay.style.left = `${gridLeft + left}px`;
    overlay.style.width = `${Math.max(0, width)}px`;
    overlay.style.height = `${Math.max(0, rows) * rowHeight}px`;
    layer.style.left = `${-left}px`;
    layer.style.width = `${gridWidth}px`;
  };

  const render = () => {
    place();
    // Row r of the pane shows content position viewTop + r; the layer puts
    // position p at p * rowHeight, shifted so the overlay's top is row
    // pinned.top.
    const first = viewTop + pinned.top;
    layer.style.transform = `translate3d(0, ${-first * rowHeight}px, 0)`;
    const from = Math.floor(first);
    const to = Math.ceil(viewTop + height - pinned.bottom);
    for (const [index, row] of shown) {
      if (index < from || index > to) {
        shown.delete(index);
        spare.push(row);
        row.style.top = "-100000px";
      }
    }
    for (let index = from; index <= to; index += 1) {
      const content = cached(index);
      let row = shown.get(index);
      if (!row) {
        row =
          spare.pop() ??
          layer.appendChild(element.ownerDocument.createElement("div"));
        row.className = "native-row";
        row.style.top = `${index * rowHeight}px`;
        shown.set(index, row);
        // A recycled row still holds its old text; always redraw it.
        drawn.delete(row);
      }
      // Rows the app has not drawn yet stay blank until they arrive.
      const html = content?.html ?? "";
      if (drawn.get(row) !== html) {
        row.innerHTML = html;
        drawn.set(row, html);
      }
      row.style.background = content?.background ?? "";
    }
  };

  const clampView = () => {
    const limits = pane.limits();
    if (!limits) return;
    // Positions are measured from the mark: older rows are negative.
    viewTop = Math.min(
      appOffset + limits.newer,
      Math.max(appOffset - limits.older, viewTop)
    );
  };

  /** Ask the app for rows up to where the view is heading. */
  const request = (lookahead: number) => {
    const limits = pane.limits();
    const moved = pane.moved();
    if (!limits || moved === null) return;
    const desired = Math.max(
      -limits.newer,
      Math.min(limits.older, Math.round(-viewTop + lookahead) + appOffset)
    );
    let delta = desired - requested;
    // Never more queued in the app than it keeps.
    const queued = requested - moved;
    if (delta > 0)
      delta = Math.min(delta, MAX_QUEUED_ROWS - Math.max(0, queued));
    if (delta < 0)
      delta = Math.max(delta, -MAX_QUEUED_ROWS - Math.min(0, queued));
    if (delta === 0) return;
    requested += delta;
    pane.scroll(delta);
  };

  const lookahead = () => {
    const rows = (Math.abs(velocity) * LOOKAHEAD_MS) / rowHeight + 2;
    return Math.sign(velocity) * Math.min(MAX_LOOKAHEAD_ROWS, rows);
  };

  const cancelFrameLoop = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };

  const close = () => {
    if (disposed) return;
    disposed = true;
    cancelFrameLoop();
    if (quietTimer !== null) clearTimeout(quietTimer);
    if (settleTimer !== null) clearTimeout(settleTimer);
    observer?.disconnect();
    overlay.remove();
    pinnedByElement.set(element, { ...pinned });
    if (views.get(element) === view) views.delete(element);
  };

  /** At rest: once the app and the screen show the view's rows, hand back. */
  const tryLand = () => {
    if (disposed || frame !== null) return;
    const target = Math.round(-viewTop);
    if (landingSince === null) {
      landingSince = now();
      corrections = 0;
    }
    if (quietTimer === null) {
      const screen = -paneTop;
      if (screen === target) {
        close();
        return;
      }
      // Everything asked for is done, yet the screen is a few rows off:
      // the app's position and its screen differ (a pinned header). Ask
      // for the difference, and keep asking that much more from now on.
      if (pane.moved() === requested && corrections < MAX_CORRECTIONS) {
        corrections += 1;
        appOffset += target - screen;
        request(0);
      }
    }
    if (now() - landingSince > LAND_TIMEOUT_MS) close();
  };

  // A redraw that reads as a scroll moves paneTop and fills the cache;
  // anything else (a partial frame, a status tick) is left until the
  // screen goes quiet, when the app's own position re-anchors it.
  const readFrame = () => {
    settleTimer = null;
    if (disposed) return;
    const next = readCells();
    // Once known, the pinned rows stay: a row that seems to join them is a
    // row the app redrew (its header taking over a line), not a scroll.
    const known = pinnedKnown ? pinned : undefined;
    const olderShift = detectPaneShift(cells, next, 1, known);
    const shift = olderShift ?? detectPaneShift(cells, next, -1, known);
    if (!shift) return;
    const nextTop = paneTop + (olderShift ? -shift.rows : shift.rows);
    const end = height - shift.bottom;
    // Frames drawn in pieces can sit half done for a while: rows scrolled
    // in are still the old ones, so a row that was on screen once now
    // shows twice. Such a frame, or one that contradicts rows already
    // seen, is left for the next.
    const entering = olderShift
      ? [shift.top, shift.top + shift.rows]
      : [end - shift.rows, end];
    const before = new Map<string, number>();
    for (const line of cells) before.set(line, (before.get(line) ?? 0) + 1);
    for (let r = entering[0]; r < entering[1]; r += 1) {
      if (next[r].trim() === "" || (before.get(next[r]) ?? 0) > 1) continue;
      for (let other = shift.top; other < end; other += 1) {
        if (other !== r && next[other] === next[r]) return;
      }
    }
    if (looksTorn(next, shift.top, end)) return;
    if (conflicts(nextTop, next, shift.top, end) >= 2) return;
    // The screen can only be between where it was, where the app says it
    // is and where it was asked to go; a reading beyond is a misreading.
    const moved = pane.moved();
    if (moved !== null) {
      const app = appOffset - moved;
      const asked = appOffset - requested;
      const low = Math.min(paneTop, app, asked) - 1;
      const high = Math.max(paneTop, app, asked) + 1;
      if (nextTop < low || nextTop > high) return;
    }
    // Rows first seen as content that turn out to be pinned (the first
    // gesture, before the pinned rows were known) are not content.
    for (let r = pinned.top; r < shift.top; r += 1) {
      cache.delete(base + paneTop + r);
    }
    for (let r = pinned.bottom; r < shift.bottom; r += 1) {
      cache.delete(base + paneTop + height - 1 - r);
    }
    paneTop = nextTop;
    pinned.top = shift.top;
    pinned.bottom = shift.bottom;
    pinnedKnown = true;
    cells = next;
    // Only rows this frame shares with the last are stored: both frames
    // agree on them. Rows just scrolled in wait for the next frame, which
    // shows whether they were drawn in the right place.
    if (olderShift) remember(shift.top + shift.rows, end);
    else remember(shift.top, end - shift.rows);
    render();
  };

  const onRedraw = () => {
    if (disposed) return;
    // Apps that do not use synchronized output are drawn in pieces as tmux
    // passes them on; a frame is read once it has stopped changing, never
    // half drawn.
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(readFrame, SETTLE_MS);
    if (quietTimer !== null) clearTimeout(quietTimer);
    quietTimer = setTimeout(onQuiet, QUIET_MS);
  };

  // The screen has not changed for QUIET_MS: it shows the app's position.
  const onQuiet = () => {
    quietTimer = null;
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      readFrame();
    }
    if (disposed) return;
    const moved = pane.moved();
    const latest = readCells();
    const text = latest.join("\n");
    if (text !== cells.join("\n") && moved !== null) {
      // Frames that could not be read: find where the screen is now.
      const top = locate(latest, appOffset - moved);
      const clash =
        conflicts(top, latest, pinned.top, latest.length - pinned.bottom) >= 2;
      // The app can leave a redraw half done for a few hundred ms, so a
      // screen is believed only once it has stayed the same, and one that
      // looks half drawn has to stay longer.
      quietChecks = quietText === text ? quietChecks + 1 : 1;
      quietText = text;
      const needed = looksTorn(
        latest,
        pinned.top,
        latest.length - pinned.bottom
      )
        ? TORN_QUIET_CHECKS
        : 2;
      if (quietChecks < needed) {
        quietTimer = setTimeout(onQuiet, QUIET_MS);
        return;
      }
      // The content changed under the cache.
      if (clash) cache.clear();
      paneTop = top;
      cells = latest;
      showScreen();
    }
    quietText = null;
    quietChecks = 0;
    render();
    tryLand();
  };
  const observer =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(onRedraw);
  observer?.observe(grid, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  /**
   * Coast after release and come to rest exactly on a row. The rest point
   * is where plain momentum would stop, rounded to a whole row; the glide
   * eases out onto it (cubic, starting at the release speed), so it neither
   * crawls for the last pixels nor snaps back.
   */
  const glide = (initial: number) => {
    cancelFrameLoop();
    const start = viewTop;
    const limits = pane.limits();
    const flicked = Math.abs(initial) >= MOMENTUM_STOP_VELOCITY;
    let target = Math.round(
      start - (flicked ? (initial * MOMENTUM_TIME_CONSTANT_MS) / rowHeight : 0)
    );
    if (limits)
      target = Math.min(
        appOffset + limits.newer,
        Math.max(appOffset - limits.older, target)
      );
    const distance = target - start; // rows
    const speed = -initial / rowHeight; // rows/ms, the same way
    // x(t) = target - distance * (1 - t/T)^3 starts at speed 3 * distance / T.
    const duration =
      flicked && distance * speed > 0
        ? Math.max(MIN_GLIDE_MS, (3 * distance) / speed)
        : 0;
    let elapsedTotal = 0;
    let previous: number | null = null;
    const step = (time: number) => {
      const elapsed = previous === null ? 16 : Math.min(32, time - previous);
      previous = time;
      elapsedTotal += elapsed;
      if (duration > 0) {
        const left = Math.max(0, 1 - elapsedTotal / duration);
        viewTop = target - distance * left ** 3;
        velocity = ((-3 * distance * left ** 2) / duration) * rowHeight;
      } else {
        // Released without a flick: settle on the nearest row, quickly.
        viewTop +=
          (target - viewTop) * (1 - Math.exp(-elapsed / SNAP_TIME_CONSTANT_MS));
        velocity = 0;
      }
      if (Math.abs(target - viewTop) * rowHeight < 0.3) viewTop = target;
      if (viewTop === target) {
        velocity = 0;
        render();
        frame = null;
        request(0);
        tryLand();
        return;
      }
      // The rest point is known: ask for the rows up to it now.
      const ahead = viewTop - target;
      request(Math.sign(ahead) * Math.min(MAX_LOOKAHEAD_ROWS, Math.abs(ahead)));
      render();
      frame = requestFrame(step);
    };
    frame = requestFrame(step);
  };

  const view: NativeView = {
    move(delta) {
      if (disposed || delta === 0) return;
      cancelFrameLoop();
      landingSince = null;
      const time = now();
      const elapsed = Math.max(1, time - lastMoveAt);
      lastMoveAt = time;
      velocity += (delta / elapsed - velocity) * 0.5;
      viewTop -= delta / rowHeight;
      clampView();
      request(lookahead());
      render();
    },
    fling(initial) {
      if (disposed) return;
      landingSince = null;
      glide(initial);
    },
    stop() {
      cancelFrameLoop();
      velocity = 0;
      lastMoveAt = now();
      landingSince = null;
    },
    dispose: close,
  };
  views.set(element, view);
  render();
  return view;
}
