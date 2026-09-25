"use client";

import { readCopyModePosition } from "./copy-mode";
import { MOMENTUM_TIME_CONSTANT_MS } from "./momentum";
import type { NativeScrollTarget } from "./native-panes";

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

/**
 * How far a whole pane moved between two frames, or null. Unlike
 * detectScrollShift, every row the two frames share must match: a frame
 * that tmux delivered in pieces (half old, half new) is rejected rather than
 * read as a smaller scroll. Apps pin a few rows while their content scrolls
 * (jcode keeps the current question at the top of the chat), so up to
 * MAX_PINNED_TOP rows at the top and MAX_PINNED_BOTTOM at the bottom may be
 * left out; `top` and `bottom` say how many were.
 */
export function detectPaneShift(
  before: readonly string[],
  after: readonly string[],
  direction: PanDirection
): { rows: number; top: number; bottom: number } | null {
  const rows = Math.min(before.length, after.length);
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  for (let top = 0; top <= MAX_PINNED_TOP; top += 1) {
    for (let bottom = 0; bottom <= MAX_PINNED_BOTTOM; bottom += 1) {
      const end = rows - bottom;
      for (let k = 1; k < end - top - 2; k += 1) {
        let evidence = 0;
        let matches = true;
        for (let i = top; i < end - k && matches; i += 1) {
          const from = direction === 1 ? i : i + k;
          const to = direction === 1 ? i + k : i;
          if (after[to] !== before[from]) matches = false;
          else if (after[to].trim() !== "" && counts.get(after[to]) === 1) {
            evidence += 1;
          }
        }
        if (matches && evidence >= 2) return { rows: k, top, bottom };
      }
    }
  }
  return null;
}

const MAX_PINNED_TOP = 2;
const MAX_PINNED_BOTTOM = 1;

interface TuiPanConfig {
  element: HTMLElement;
  sendWheel: (lines: number) => void;
  now?: () => number;
  requestFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

// The glide onto a row after a flick decays like momentum, but never
// slower than this (px/ms), so it lands instead of crawling the last pixels.
const MIN_GLIDE_SPEED = 0.25;
// A release without a flick settles onto the nearest row this quickly.
const SNAP_TIME_CONSTANT_MS = 40;
const MIN_EDGE_TIMEOUT_MS = 250;
const SETTLE_MS = 160;
const LATE_REDRAW_WINDOW_MS = 1200;
const MIN_CHANGED_ROWS_FOR_UNKNOWN_SCROLL = 3;
const MAX_REPORTS_PER_FRAME = 8;
// jcode drops queued scroll beyond 30 rows; stay under it so every row
// asked for is a row that arrives.
const NATIVE_MAX_IN_FLIGHT = 24;
// Requests the app has not acted on for this long are taken as dropped.
const NATIVE_DROPPED_MS = 600;
// A native pane is re-read from scratch once its redraws have been quiet
// this long (the app has finished drawing).
const NATIVE_RESYNC_QUIET_MS = 120;

export interface TuiPan {
  /**
   * A touch landed. `native` is the app-reported pane under it, if the app
   * speaks the native scroll protocol (see native-panes.ts).
   */
  begin(rowHeight: number, native?: NativeScrollTarget | null): void;
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
  // Direction of the latest finger (or glide) movement.
  let lastDirection: 0 | PanDirection = 0;
  // Pane reported by the app itself: exact rows, ends and one-row steps.
  let native: NativeScrollTarget | null = null;
  // Native bookkeeping, counted from native.mark() at the gesture's start,
  // when the screen shows the app's position. Requests are paced in the
  // app's own count: what it reports it has moved (native.moved()) taken
  // from what was requested is what it still has queued, so a row is never
  // asked for twice however the app paces its redraws. What the view shows
  // comes from the screen; mid-animation the two can be a frame or two
  // apart, but once the screen is quiet they agree (see resyncNative).
  let nativeBase = 0; // contentMoved at mark()
  let nativeRequested = 0;
  // A redraw could not be read since the last one that was.
  let nativeUnread = false;
  let nativeMovedAt = 0;
  let nativeLastMoved = 0;
  // Rows the app keeps pinned at the pane's top and bottom, as last seen.
  let pinned = { top: 0, bottom: 0 };
  let resyncTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (native) {
      // Exact, from the app: rows beyond the marked position, less the rows
      // the screen has already moved.
      const limits = native.limits();
      if (!limits) return 0;
      return direction === 1
        ? Math.max(0, limits.older - (contentMoved - nativeBase))
        : Math.max(0, limits.newer + (contentMoved - nativeBase));
    }
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
      native !== null ||
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
    // Native panes know their ends and queue exactly (see resyncNative).
    if (native) return;
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

    if (native) {
      // Compare only the pane's own cells, leaving out its last column
      // (the app's scrollbar, whose thumb moves as it scrolls). tmux can
      // deliver a frame in pieces, so a frame that does not match is not
      // trusted as a baseline either: once the screen has been quiet, it is
      // re-read and the distance taken from the app's own position.
      const pane = native;
      const cells = (rows: string[]) =>
        rows
          .slice(pane.top, pane.bottom + 1)
          .map((row) => row.slice(pane.left, pane.right));
      if (direction !== 0) {
        const shift = detectPaneShift(cells(snapshot), cells(after), direction);
        if (shift === null) {
          nativeUnread = true;
          scheduleResync();
          return;
        }
        // Native steps are exactly one row each; the app may animate a
        // multi-row request over several redraws. Pinned rows stay still.
        confirm(direction, shift.rows, shift.rows);
        nativeMoved();
        // Read against the last frame that was read, so it covers any
        // unreadable ones in between.
        nativeUnread = false;
        syncNativePending();
        pinned = { top: shift.top, bottom: shift.bottom };
        band = {
          rows: shift.rows,
          top: pane.top + pinned.top,
          bottom: pane.bottom - pinned.bottom,
        };
        snapshot = after;
        // Only a screen that has gone quiet matches the app's own position.
        scheduleResync();
        if (active) render();
        return;
      }
      scheduleResync();
      return;
    }

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

  const cancelResync = () => {
    if (resyncTimer !== null) clearTimeout(resyncTimer);
    resyncTimer = null;
  };

  function scheduleResync() {
    cancelResync();
    resyncTimer = setTimeout(resyncNative, NATIVE_RESYNC_QUIET_MS);
  }

  /** Rows the app has moved since mark(), noting when that last changed. */
  function nativeMoved(): number | null {
    const moved = native?.moved() ?? null;
    if (moved !== null && moved !== nativeLastMoved) {
      nativeLastMoved = moved;
      nativeMovedAt = now();
    }
    return moved;
  }

  /** Rows requested that the screen has not shown yet. */
  function syncNativePending() {
    reportsPending = nativeBase + nativeRequested - contentMoved;
  }

  function resyncNative() {
    resyncTimer = null;
    if (!native || !grid) return;
    const moved = nativeMoved();
    if (moved === null) return;
    // The screen has been quiet, so it shows what the app last drew. Frames
    // that were read are exact; if some could not be (e.g. a jump bigger
    // than the pane), the app's own position stands in for them.
    snapshot = readRows();
    if (nativeUnread) {
      const before = contentMoved;
      contentMoved = nativeBase + moved;
      if (contentMoved !== before) {
        provenDirection = Math.sign(contentMoved - before) as PanDirection;
      }
      nativeUnread = false;
    }
    // Requests the app has sat on for a while were dropped (it reached an
    // end, or its queue was full): stop waiting for them.
    if (now() - nativeMovedAt > NATIVE_DROPPED_MS) nativeRequested = moved;
    syncNativePending();
    clampPan();
    if (active) render();
  }

  const cancelFling = () => {
    if (flingFrame !== null) cancelFrame(flingFrame);
    flingFrame = null;
  };

  const cancelSettle = () => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  };

  const begin = (
    measuredRowHeight: number,
    nativeTarget: NativeScrollTarget | null = null
  ) => {
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
      if (native && !nativeTarget) band = null;
      native = nativeTarget;
      translating = true;
      cancelResync();
      if (native) {
        native.mark();
        nativeBase = contentMoved;
        nativeRequested = 0;
        nativeUnread = false;
        nativeLastMoved = 0;
        nativeMovedAt = now();
        band = {
          rows: 0,
          top: native.top + pinned.top,
          bottom: native.bottom - pinned.bottom,
        };
        copyMode = null;
        linesPerReport = 1;
        stepLearned = true;
        blocked = 0;
        // Sliding whole rows would drag a neighbouring pane along too, so a
        // pane narrower than the screen steps by rows (still exact).
        const width = snapshot[0]?.length ?? 0;
        translating = native.right - native.left + 1 >= width - 2;
      }
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
    lastDirection = direction;
    if (blocked !== 0 && blocked !== direction) {
      blocked = 0;
      probeTravel = 0;
    }
    if (blocked === direction && !copyMode && !native) {
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
    const reports = requestSteps(direction);
    render();
    return followed || reports > 0;
  };

  /**
   * Ask the app for the steps that bring the content up to the finger (or
   * glide) position, in `direction`. Returns how many reports were sent.
   */
  function requestSteps(direction: PanDirection): number {
    if (native) return requestNativeSteps(direction);
    // Ask for the next step halfway through it, so the gap at the leading
    // edge stays under half a step.
    const expected = contentMoved + reportsPending * linesPerReport;
    const ahead = panTotal / rowHeight - expected;
    if (Math.sign(ahead) !== direction) return 0;
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
    if (reports <= 0) return 0;
    if (reportsPending === 0) sentAt = now();
    reportsPending += direction * reports;
    sendWheel(direction * reports);
    armEdgeTimer();
    return reports;
  }

  /**
   * Native panes: ask for the rows that bring the app's target (everything
   * requested so far) up to the finger, never more than the app accepts
   * queued, and never past either end.
   */
  function requestNativeSteps(direction: PanDirection): number {
    const target = native;
    const limits = target?.limits();
    const moved = nativeMoved();
    if (!target || !limits || moved === null) return 0;
    // Where the screen will be once everything asked for has arrived.
    const ahead = panTotal / rowHeight - (nativeBase + nativeRequested);
    if (Math.sign(ahead) !== direction) return 0;
    const queued = Math.max(0, direction * (nativeRequested - moved));
    const toEdge =
      direction === 1
        ? limits.older - nativeRequested
        : limits.newer + nativeRequested;
    const rows = Math.min(
      Math.trunc(Math.abs(ahead) + 0.5),
      NATIVE_MAX_IN_FLIGHT - queued,
      toEdge
    );
    if (rows <= 0) return 0;
    if (reportsPending === 0) sentAt = now();
    nativeRequested += direction * rows;
    target.scroll(direction * rows);
    syncNativePending();
    return rows;
  }

  const finish = () => {
    cancelSettle();
    // A fast glide can end before the app has caught up (it scrolls at its
    // own pace); keep asking until the content reaches where the view is.
    const requested = native ? nativeBase + nativeRequested : contentMoved;
    const gap = panTotal / rowHeight - requested;
    // Only ever onwards: rows already asked for are never taken back.
    if (
      Math.abs(gap) >= linesPerReport / 2 &&
      Math.sign(gap) === lastDirection
    ) {
      requestSteps(Math.sign(gap) as PanDirection);
    }
    if (native) {
      // Wait until the app has done everything asked of it and the screen
      // has gone quiet (resyncNative has run); an app that stopped
      // answering altogether is let go.
      const moved = nativeMoved();
      const busy = moved !== null && moved !== nativeRequested;
      if (
        moved === null ||
        (busy && now() - nativeMovedAt > NATIVE_DROPPED_MS)
      ) {
        if (moved !== null) nativeRequested = moved;
      } else if (busy || resyncTimer !== null) {
        settleTimer = setTimeout(finish, 40);
        return;
      }
      reportsPending = 0;
    }
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
    let target = panTotal + velocity * MOMENTUM_TIME_CONSTANT_MS;
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
    if (native) {
      // Rows are requested half a row early, so some may already be on
      // their way past the rounded target: glide onto them rather than
      // pulling the view back.
      const committed = (nativeBase + nativeRequested) * rowHeight;
      if (lastDirection === 1) target = Math.max(target, committed);
      if (lastDirection === -1) target = Math.min(target, committed);
    }

    const timeConstant =
      velocity === 0 ? SNAP_TIME_CONSTANT_MS : MOMENTUM_TIME_CONSTANT_MS;
    let position = panTotal;
    let previousPosition = position;
    let previousTime: number | null = null;
    const frame = (time: number) => {
      const elapsed =
        previousTime === null ? 16 : Math.min(32, time - previousTime);
      previousTime = time;
      const remaining = target - position;
      const speed = Math.max(
        Math.abs(remaining) / timeConstant,
        MIN_GLIDE_SPEED
      );
      const step =
        Math.sign(remaining) * Math.min(Math.abs(remaining), speed * elapsed);
      position += step;
      const done = Math.abs(target - position) < 0.01;
      if (done) position = target;
      const kept = move(position - previousPosition);
      previousPosition = position;
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
    cancelResync();
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
