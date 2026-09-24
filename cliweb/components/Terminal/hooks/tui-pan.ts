"use client";

/**
 * Pixel-smooth touch panning over line-based TUIs.
 *
 * tmux copy mode and apps such as opencode can only move text by whole rows,
 * and each wheel report may move several rows. While a finger drags, the rows
 * that scroll are translated by the finger's remainder; after every redraw
 * the rows are compared with the previous frame to learn how far, and which
 * band of rows, actually moved, and that distance is taken back out of the
 * translation. Fixed chrome (headers, input boxes) outside the band stays
 * put, and the ends of the history are remembered so the view never
 * overshoots and bounces back.
 */

/** Positive = content moves down (towards older output). */
export type PanDirection = 1 | -1;

export interface ScrollShift {
  rows: number;
  /** First and last row of the region that scrolled, inclusive. */
  top: number;
  bottom: number;
}

/**
 * Finds how far a band of rows moved between two frames. `direction` 1 means
 * content moved down (after[i] === before[i - k]). Returns null when no
 * convincing shift is present, e.g. the frame was a spinner tick.
 */
export function detectScrollShift(
  before: readonly string[],
  after: readonly string[],
  direction: PanDirection
): ScrollShift | null {
  const rows = Math.min(before.length, after.length);
  if (rows < 3) return null;

  // Repeated lines (box borders, blank rows) match at every offset, so only
  // lines that occur once in the previous frame count as evidence.
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  const isEvidence = (line: string) =>
    line.trim() !== "" && counts.get(line) === 1;

  let best: { run: number; start: number; k: number } | null = null;
  for (let k = 1; k <= rows - 3; k += 1) {
    let runStart = -1;
    let evidence = 0;
    const closeRun = (end: number) => {
      const run = end - runStart;
      if (run >= 3 && evidence >= 2 && (!best || run > best.run)) {
        best = { run, start: runStart, k };
      }
      runStart = -1;
      evidence = 0;
    };
    for (let i = 0; i < rows; i += 1) {
      const source = i - direction * k;
      const matches =
        source >= 0 && source < rows && after[i] === before[source];
      if (matches) {
        if (runStart < 0) runStart = i;
        if (isEvidence(after[i])) evidence += 1;
      } else if (runStart >= 0) {
        closeRun(i);
      }
    }
    if (runStart >= 0) closeRun(rows);
  }

  if (!best) return null;
  const { run, start, k } = best as { run: number; start: number; k: number };
  const end = start + run - 1;
  // The band includes the rows that scrolled into view on the leading edge.
  return direction === 1
    ? { rows: k, top: Math.max(0, start - k), bottom: end }
    : { rows: k, top: start, bottom: Math.min(rows - 1, end + k) };
}

interface TuiPanConfig {
  element: HTMLElement;
  sendWheel: (lines: number) => void;
  now?: () => number;
}

const MIN_EDGE_TIMEOUT_MS = 250;
const SETTLE_MS = 160;
const LATE_REDRAW_WINDOW_MS = 1200;
const MIN_CHANGED_ROWS_FOR_UNKNOWN_SCROLL = 3;

export interface TuiPan {
  begin(rowHeight: number): void;
  move(fingerDeltaY: number): void;
  settle(): void;
  /** Process a redraw now; normally driven by a MutationObserver. */
  handleRedraw(): void;
  dispose(): void;
}

export function createTuiPan(config: TuiPanConfig): TuiPan {
  const { element, sendWheel } = config;
  const now = config.now ?? (() => performance.now());

  let grid: HTMLElement | null = null;
  let rowHeight = 20;
  let linesPerReport = 1;
  let panTotal = 0; // finger travel in px
  let contentMoved = 0; // rows the content has actually moved
  let reportsPending = 0; // signed wheel reports awaiting a redraw
  let blocked: 0 | PanDirection = -1; // attaches start at the live bottom
  let edgeReachedAt = 0;
  let probeTravel = 0;
  let snapshot: string[] = [];
  let band: ScrollShift | null = null; // null = whole grid
  let translating = true; // false after an unrecognisable scroll
  let styledRows: HTMLElement[] = [];
  let edgeTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let sentAt = 0;
  let latency = 120;
  let active = false;

  const rowElements = (): HTMLElement[] =>
    grid
      ? Array.from(
          grid.querySelectorAll<HTMLElement>(
            ".term-row:not(.term-scrollback-row)"
          )
        )
      : [];
  const readRows = () => rowElements().map((row) => row.textContent ?? "");

  const observer =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => handleRedraw());

  const clearEdgeTimer = () => {
    if (edgeTimer !== null) clearTimeout(edgeTimer);
    edgeTimer = null;
  };

  const clearStyles = () => {
    for (const row of styledRows) {
      row.style.transform = "";
      row.style.clipPath = "";
      row.style.transition = "";
      row.style.willChange = "";
    }
    styledRows = [];
    if (grid) {
      grid.style.transform = "";
      grid.style.transition = "";
      grid.style.willChange = "";
    }
  };

  const offsetPx = () => {
    const raw = panTotal - contentMoved * rowHeight;
    const limit = (linesPerReport / 2 + 0.25) * rowHeight;
    let offset = Math.max(-limit, Math.min(limit, raw));
    // Never pull past a known end of the history.
    if (blocked !== 0 && Math.sign(offset) === blocked) offset = 0;
    return translating ? offset : 0;
  };

  const render = (transition = "") => {
    if (!grid) return;
    const offset = offsetPx();
    const rows = rowElements();
    const wholeGrid =
      !band || (band.top <= 0 && band.bottom >= rows.length - 1);

    if (wholeGrid) {
      if (styledRows.length) clearStyles();
      grid.style.transition = transition;
      grid.style.willChange = "transform";
      grid.style.transform =
        Math.abs(offset) < 0.01 ? "" : `translate3d(0, ${offset}px, 0)`;
      return;
    }

    grid.style.transform = "";
    const next: HTMLElement[] = [];
    const bandTop = band!.top * rowHeight;
    const bandBottom = (band!.bottom + 1) * rowHeight;
    rows.forEach((row, index) => {
      if (index < band!.top || index > band!.bottom) return;
      next.push(row);
      const y = index * rowHeight + offset;
      // Clip each moving row to the band so it never paints over chrome.
      const clipTop = Math.max(0, bandTop - y);
      const clipBottom = Math.max(0, y + rowHeight - bandBottom);
      row.style.transition = transition;
      row.style.willChange = "transform";
      row.style.transform =
        Math.abs(offset) < 0.01 ? "" : `translate3d(0, ${offset}px, 0)`;
      row.style.clipPath =
        clipTop > 0 || clipBottom > 0
          ? `inset(${Math.min(rowHeight, clipTop)}px 0 ${Math.min(
              rowHeight,
              clipBottom
            )}px 0)`
          : "";
    });
    for (const row of styledRows) {
      if (!next.includes(row)) {
        row.style.transform = "";
        row.style.clipPath = "";
        row.style.transition = "";
        row.style.willChange = "";
      }
    }
    styledRows = next;
  };

  const reachEdge = () => {
    edgeTimer = null;
    if (reportsPending === 0) return;
    blocked = Math.sign(reportsPending) as PanDirection;
    edgeReachedAt = now();
    reportsPending = 0;
    probeTravel = 0;
    // Pin the finger to the content so reversing responds at once.
    panTotal = contentMoved * rowHeight;
    render(`transform ${SETTLE_MS}ms ease-out`);
  };

  const armEdgeTimer = () => {
    clearEdgeTimer();
    edgeTimer = setTimeout(
      reachEdge,
      Math.max(MIN_EDGE_TIMEOUT_MS, latency * 2.5)
    );
  };

  const send = (reports: number) => {
    if (reportsPending === 0) sentAt = now();
    reportsPending += reports;
    sendWheel(reports);
    armEdgeTimer();
  };

  function handleRedraw() {
    if (!grid) return;
    const after = readRows();
    if (reportsPending === 0) {
      const lateDirection = blocked;
      if (
        lateDirection !== 0 &&
        now() - edgeReachedAt < LATE_REDRAW_WINDOW_MS
      ) {
        // A slow redraw arrived after the end was assumed. Move the finger
        // origin with it so the content does not jump.
        const shift = detectScrollShift(snapshot, after, lateDirection);
        if (shift) {
          blocked = 0;
          contentMoved += lateDirection * shift.rows;
          panTotal += lateDirection * shift.rows * rowHeight;
          band = shift;
        }
      }
      snapshot = after;
      if (active) render();
      return;
    }

    const direction = Math.sign(reportsPending) as PanDirection;
    const shift = detectScrollShift(snapshot, after, direction);
    if (shift) {
      const pending = Math.abs(reportsPending);
      if (pending === 1) linesPerReport = shift.rows;
      const confirmed = Math.min(
        pending,
        Math.max(1, Math.round(shift.rows / linesPerReport))
      );
      reportsPending -= direction * confirmed;
      contentMoved += direction * shift.rows;
      latency += (now() - sentAt - latency) * 0.3;
      sentAt = now();
      band = shift;
      blocked = 0;
      translating = true;
      snapshot = after;
      if (reportsPending === 0) clearEdgeTimer();
      else armEdgeTimer();
      render();
      return;
    }

    let changed = 0;
    for (let i = 0; i < after.length; i += 1) {
      if (after[i] !== snapshot[i]) changed += 1;
    }
    if (changed >= MIN_CHANGED_ROWS_FOR_UNKNOWN_SCROLL) {
      // The screen scrolled in a way rows cannot explain (side panels,
      // redrawn layout). Fall back to plain line steps until it is readable.
      contentMoved += reportsPending * linesPerReport;
      panTotal = contentMoved * rowHeight;
      reportsPending = 0;
      clearEdgeTimer();
      translating = false;
      blocked = 0;
      snapshot = after;
      render();
    }
    // Otherwise a spinner or cursor tick: keep waiting for the scroll.
  }

  const begin = (measuredRowHeight: number) => {
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    rowHeight = measuredRowHeight;
    const nextGrid = element.querySelector<HTMLElement>(".term-grid");
    if (nextGrid !== grid) {
      clearStyles();
      observer?.disconnect();
      grid = nextGrid;
      band = null;
      if (grid) {
        observer?.observe(grid, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
    }
    if (!grid) return;
    if (!active) {
      snapshot = readRows();
      if (band && band.bottom >= snapshot.length) band = null;
    }
    active = true;
    element.classList.add("touch-panning");
    render();
  };

  const move = (fingerDeltaY: number) => {
    if (!active || fingerDeltaY === 0) return;
    const direction = Math.sign(fingerDeltaY) as PanDirection;

    if (blocked === direction) {
      // At a known end: keep the view still but probe once in a while in
      // case new content has arrived since.
      probeTravel += Math.abs(fingerDeltaY);
      if (
        reportsPending === 0 &&
        probeTravel >= linesPerReport * rowHeight
      ) {
        probeTravel = 0;
        sendWheel(direction);
        edgeReachedAt = now();
      }
      return;
    }
    if (blocked !== 0) {
      blocked = 0;
      probeTravel = 0;
    }

    panTotal += fingerDeltaY;
    // Ask for the next step halfway through it, so the gap at the leading
    // edge stays under half a step instead of a whole one.
    const expected = contentMoved + reportsPending * linesPerReport;
    const ahead = panTotal / rowHeight - expected;
    const threshold = linesPerReport / 2;
    const reports = Math.trunc(
      (Math.abs(ahead) + threshold) / linesPerReport
    );
    if (reports > 0 && Math.sign(ahead) === direction) {
      send(direction * Math.min(reports, 8));
    }
    render();
  };

  const settle = () => {
    if (!active || !grid) return;
    // Glide to where the content will rest once pending steps land.
    panTotal = (contentMoved + reportsPending * linesPerReport) * rowHeight;
    render(`transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (reportsPending !== 0) {
        // Still waiting on tmux; try again when it answers or times out.
        settleTimer = setTimeout(settle, 60);
        return;
      }
      panTotal -= contentMoved * rowHeight;
      contentMoved = 0;
      active = false;
      clearStyles();
      element.classList.remove("touch-panning");
    }, SETTLE_MS + 40);
  };

  const dispose = () => {
    clearEdgeTimer();
    if (settleTimer !== null) clearTimeout(settleTimer);
    observer?.disconnect();
    clearStyles();
    element.classList.remove("touch-panning");
  };

  return { begin, move, settle, handleRedraw, dispose };
}
