"use client";

import { readCopyModePosition } from "./copy-mode";

/**
 * Pixel-smooth touch panning over line-based TUIs.
 *
 * tmux copy mode and apps such as opencode can only move text by whole rows,
 * and each wheel report may move several rows. While a finger drags, the rows
 * that scroll are translated by the finger's remainder; after every redraw
 * the distance the content really moved is taken back out of the
 * translation, so text tracks the finger pixel for pixel.
 *
 * How far the content moved comes from tmux's copy-mode indicator when it is
 * showing (exact, and it also tells how much history is left, so the view
 * stops dead at either end), or else from comparing rows with the previous
 * frame, which also finds the band that scrolled so fixed chrome such as
 * opencode's header and input box stays put.
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
  requestFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

/** Momentum time constant; matches iOS's normal deceleration. */
export const FLING_TIME_CONSTANT_MS = 325;
const MIN_EDGE_TIMEOUT_MS = 250;
const SETTLE_MS = 160;
const LATE_REDRAW_WINDOW_MS = 1200;
const MIN_CHANGED_ROWS_FOR_UNKNOWN_SCROLL = 3;
const MAX_REPORTS_PER_FRAME = 8;

export interface TuiPan {
  begin(rowHeight: number): void;
  move(fingerDeltaY: number): void;
  /** Finger lifted: glide with `velocity` (px/ms) to the nearest row. */
  fling(velocity: number): void;
  /** Stop a running fling where it is (a new touch landed). */
  stop(): void;
  /** Process a redraw now; normally driven by a MutationObserver. */
  handleRedraw(): void;
  dispose(): void;
}

export function createTuiPan(config: TuiPanConfig): TuiPan {
  const { element, sendWheel } = config;
  const now = config.now ?? (() => performance.now());
  const requestFrame =
    config.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame =
    config.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));

  let grid: HTMLElement | null = null;
  let rowHeight = 20;
  let linesPerReport = 1;
  // Apps differ (vim and less scroll 3 lines per wheel report, opencode its
  // own amount). Each gesture sends one report first and learns the step
  // from its redraw before sending more, so the first steps cannot overshoot.
  let stepLearned = false;
  let panTotal = 0; // finger travel in px
  let contentMoved = 0; // rows the content has actually moved
  let reportsPending = 0; // signed wheel reports awaiting a redraw
  // Learned end, for apps that do not report one. Attaches start on the
  // live screen, where there is nothing newer to scroll to.
  let blocked: 0 | PanDirection = -1;
  let probeTravel = 0;
  // Direction the app last proved it can scroll in. Until it has, an unknown
  // end may be just ahead, so the view runs ahead of the content less.
  let provenDirection: 0 | PanDirection = 0;
  let edgeReachedAt = 0;
  let snapshot: string[] = [];
  let copyMode: ReturnType<typeof readCopyModePosition> = null;
  let band: ScrollShift | null = null; // null = whole grid
  let translating = true; // false after an unrecognisable scroll
  let styledRows: HTMLElement[] = [];
  let edgeTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let flingFrame: number | null = null;
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

  /** Whole rows the content can still move in `direction`. */
  const room = (direction: PanDirection): number => {
    if (copyMode) {
      // Scrolling back to position 0 leaves copy mode (entered with -e).
      return direction === 1
        ? copyMode.history - copyMode.position
        : copyMode.position;
    }
    if (blocked === direction) return 0;
    return Infinity;
  };

  const clearEdgeTimer = () => {
    if (edgeTimer !== null) clearTimeout(edgeTimer);
    edgeTimer = null;
  };

  const resetRow = (row: HTMLElement) => {
    row.style.transform = "";
    row.style.clipPath = "";
    row.style.transition = "";
    row.style.willChange = "";
  };

  const clearStyles = () => {
    styledRows.forEach(resetRow);
    styledRows = [];
    if (grid) {
      grid.style.transform = "";
      grid.style.transition = "";
      grid.style.willChange = "";
    }
  };

  const offsetPx = () => {
    if (!translating) return 0;
    const raw = panTotal - contentMoved * rowHeight;
    // While a step is in flight the view may run ahead of the content by
    // about half a step, never more. tmux states its ends exactly; for other
    // apps an unproven direction may end right here, so keep any overshoot
    // there barely visible.
    // Moving back over rows already scrolled past is always safe.
    const proven =
      copyMode !== null ||
      provenDirection === Math.sign(raw) ||
      Math.sign(raw) === -Math.sign(contentMoved);
    const limit = proven
      ? (linesPerReport / 2 + 0.25) * rowHeight
      : 0.4 * rowHeight;
    return Math.max(-limit, Math.min(limit, raw));
  };

  const render = (transition = "") => {
    if (!grid) return;
    const offset = offsetPx();
    const transform =
      Math.abs(offset) < 0.01 ? "" : `translate3d(0, ${offset}px, 0)`;
    const rows = rowElements();
    const wholeGrid =
      copyMode !== null ||
      !band ||
      (band.top <= 0 && band.bottom >= rows.length - 1);

    if (wholeGrid) {
      if (styledRows.length) {
        styledRows.forEach(resetRow);
        styledRows = [];
      }
      grid.style.transition = transition;
      grid.style.transform = transform;
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
      const clipTop = Math.min(rowHeight, Math.max(0, bandTop - y));
      const clipBottom = Math.min(
        rowHeight,
        Math.max(0, y + rowHeight - bandBottom)
      );
      row.style.transition = transition;
      row.style.willChange = "transform";
      row.style.transform = transform;
      row.style.clipPath =
        clipTop > 0 || clipBottom > 0
          ? `inset(${clipTop}px 0 ${clipBottom}px 0)`
          : "";
    });
    for (const row of styledRows) if (!next.includes(row)) resetRow(row);
    styledRows = next;
  };

  /** Keep the finger inside the history that exists. */
  const clampPan = () => {
    const up = room(1);
    const down = room(-1);
    if (Number.isFinite(up)) {
      panTotal = Math.min(panTotal, (contentMoved + up) * rowHeight);
    }
    if (Number.isFinite(down)) {
      panTotal = Math.max(panTotal, (contentMoved - down) * rowHeight);
    }
  };

  const reachEdge = () => {
    edgeTimer = null;
    if (reportsPending === 0) return;
    blocked = Math.sign(reportsPending) as PanDirection;
    if (provenDirection === blocked) provenDirection = 0;
    edgeReachedAt = now();
    reportsPending = 0;
    clampPan();
    render(`transform ${SETTLE_MS}ms ease-out`);
  };

  const armEdgeTimer = () => {
    clearEdgeTimer();
    const timeout = Math.max(MIN_EDGE_TIMEOUT_MS, latency * 2.5);
    if (copyMode) {
      // tmux reports its own ends through the indicator, so an unanswered
      // step there was simply dropped: forget it without assuming an end.
      edgeTimer = setTimeout(() => {
        edgeTimer = null;
        reportsPending = 0;
      }, timeout * 2);
      return;
    }
    // Apps that reach an end simply stop redrawing.
    edgeTimer = setTimeout(reachEdge, timeout);
  };

  const confirm = (direction: PanDirection, rows: number, reports: number) => {
    reportsPending -= direction * Math.min(Math.abs(reportsPending), reports);
    contentMoved += direction * rows;
    if (rows > 0) provenDirection = direction;
    latency += (now() - sentAt - latency) * 0.3;
    sentAt = now();
    blocked = 0;
    translating = true;
    if (reportsPending === 0) clearEdgeTimer();
    else armEdgeTimer();
  };

  function handleRedraw() {
    if (!grid) return;
    const after = readRows();
    const nextCopyMode = readCopyModePosition(after[0]);
    const direction = Math.sign(reportsPending) as 0 | PanDirection;

    if (copyMode || nextCopyMode) {
      // tmux says exactly where the view is. Leaving copy mode means the
      // view is back at the live screen, position 0.
      const before = copyMode?.position ?? 0;
      const current = nextCopyMode?.position ?? 0;
      const moved = current - before;
      copyMode = nextCopyMode;
      band = null;
      linesPerReport = 1;
      if (direction !== 0) {
        if (moved !== 0 && Math.sign(moved) === direction) {
          confirm(direction, Math.abs(moved), Math.abs(moved));
        } else if (!copyMode || (before === 0 && current === 0)) {
          // Entered copy mode without moving, or left it: one report used.
          confirm(direction, 0, 1);
        }
        if (!copyMode && direction === -1) {
          // Back at the live screen: nothing newer to scroll to.
          reportsPending = 0;
          blocked = -1;
          clearEdgeTimer();
        }
        if (room(direction) === 0) {
          reportsPending = 0;
          clearEdgeTimer();
        }
      } else if (moved !== 0 && active) {
        // A late redraw for a step already written off: keep the finger
        // anchored to the text rather than jumping.
        contentMoved += moved;
        panTotal += moved * rowHeight;
      }
      snapshot = after;
      clampPan();
      if (active) render();
      return;
    }

    if (direction === 0) {
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

    const shift = detectScrollShift(snapshot, after, direction);
    if (shift) {
      const pending = Math.abs(reportsPending);
      if (pending === 1) {
        linesPerReport = shift.rows;
        stepLearned = true;
      }
      const reports = Math.max(1, Math.round(shift.rows / linesPerReport));
      confirm(direction, shift.rows, reports);
      band = shift;
      snapshot = after;
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

  const cancelFling = () => {
    if (flingFrame !== null) cancelFrame(flingFrame);
    flingFrame = null;
  };

  const cancelSettle = () => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  };

  const begin = (measuredRowHeight: number) => {
    cancelFling();
    cancelSettle();
    if (measuredRowHeight > 0) rowHeight = measuredRowHeight;
    const nextGrid = element.querySelector<HTMLElement>(".term-grid");
    if (nextGrid !== grid) {
      clearStyles();
      observer?.disconnect();
      grid = nextGrid;
      band = null;
      active = false;
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
      copyMode = readCopyModePosition(snapshot[0]);
      stepLearned = false;
      if (band && band.bottom >= snapshot.length) band = null;
      panTotal = contentMoved * rowHeight;
    }
    active = true;
    grid.style.willChange = "transform";
    element.classList.add("touch-panning");
    render();
  };

  /** Returns false once the content cannot follow any further. */
  const move = (fingerDeltaY: number): boolean => {
    if (!active || fingerDeltaY === 0) return true;
    const direction = Math.sign(fingerDeltaY) as PanDirection;
    if (blocked !== 0 && blocked !== direction) {
      blocked = 0;
      probeTravel = 0;
    }
    if (blocked === direction && !copyMode) {
      // An end learned only from silence may have moved (new output, or a
      // guess made too early). Probe once per step without moving the view;
      // a redraw that answers is absorbed as a late redraw.
      probeTravel += Math.abs(fingerDeltaY);
      if (reportsPending === 0 && probeTravel >= linesPerReport * rowHeight) {
        probeTravel = 0;
        edgeReachedAt = now();
        sendWheel(direction);
      }
      return false;
    }

    const before = panTotal;
    panTotal += fingerDeltaY;
    clampPan();
    const followed = panTotal !== before;

    // Ask for the next step halfway through it, so the gap at the leading
    // edge stays under half a step.
    const expected = contentMoved + reportsPending * linesPerReport;
    const ahead = panTotal / rowHeight - expected;
    const inFlight = Math.max(0, direction * reportsPending) * linesPerReport;
    const available = room(direction) - inFlight;
    let reports = Math.trunc(
      (Math.abs(ahead) + linesPerReport / 2) / linesPerReport
    );
    reports = Math.min(reports, MAX_REPORTS_PER_FRAME);
    if (Number.isFinite(available)) {
      reports = Math.min(reports, Math.ceil(available / linesPerReport));
    }
    if (!copyMode && !stepLearned) {
      // One report at a time until a redraw shows how far one moves.
      reports = reportsPending === 0 ? Math.min(reports, 1) : 0;
    }
    if (reports > 0 && Math.sign(ahead) === direction) {
      if (reportsPending === 0) sentAt = now();
      reportsPending += direction * reports;
      sendWheel(direction * reports);
      armEdgeTimer();
    }
    render();
    return followed || reports > 0;
  };

  const finish = () => {
    cancelSettle();
    if (reportsPending !== 0) {
      // Let the last steps land (or time out) before letting go.
      settleTimer = setTimeout(finish, 40);
      return;
    }
    const remaining = offsetPx();
    const release = () => {
      settleTimer = null;
      panTotal -= contentMoved * rowHeight;
      contentMoved = 0;
      active = false;
      clearStyles();
      element.classList.remove("touch-panning");
    };
    if (Math.abs(remaining) >= 0.5) {
      // The app moved a different distance than the glide aimed for.
      panTotal = contentMoved * rowHeight;
      render(`transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`);
      settleTimer = setTimeout(release, SETTLE_MS + 20);
    } else {
      release();
    }
  };

  const fling = (velocity: number) => {
    if (!active || !grid) return;
    cancelFling();
    // Project where the momentum would come to rest, clamp it to the
    // history that exists, and round it to a whole step, so the view glides
    // straight onto a row instead of snapping after it stops.
    let target = panTotal + velocity * FLING_TIME_CONSTANT_MS;
    const up = room(1);
    const down = room(-1);
    if (Number.isFinite(up)) {
      target = Math.min(target, (contentMoved + up) * rowHeight);
    }
    if (Number.isFinite(down)) {
      target = Math.max(target, (contentMoved - down) * rowHeight);
    }
    const step = linesPerReport * rowHeight;
    const base = contentMoved * rowHeight;
    target = base + Math.round((target - base) / step) * step;
    if (Number.isFinite(up)) {
      target = Math.min(target, (contentMoved + up) * rowHeight);
    }
    if (Number.isFinite(down)) {
      target = Math.max(target, (contentMoved - down) * rowHeight);
    }

    const start = panTotal;
    let startTime: number | null = null;
    let previous = start;
    const frame = (time: number) => {
      if (startTime === null) startTime = time;
      const elapsed = time - startTime;
      const position =
        target + (start - target) * Math.exp(-elapsed / FLING_TIME_CONSTANT_MS);
      const done = Math.abs(target - position) < 0.5;
      const next = done ? target : position;
      const kept = move(next - previous);
      previous = next;
      if (done || !kept) {
        flingFrame = null;
        finish();
        return;
      }
      flingFrame = requestFrame(frame);
    };
    flingFrame = requestFrame(frame);
  };

  const stop = () => {
    cancelFling();
    cancelSettle();
  };

  const dispose = () => {
    cancelFling();
    cancelSettle();
    clearEdgeTimer();
    observer?.disconnect();
    clearStyles();
    element.classList.remove("touch-panning");
  };

  return {
    begin,
    move: (delta) => void move(delta),
    fling,
    stop,
    handleRedraw,
    dispose,
  };
}
