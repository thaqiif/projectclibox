export const MIN_TERMINAL_COLS = 1;
export const MAX_TERMINAL_COLS = 500;
export const MIN_TERMINAL_ROWS = 1;
export const MAX_TERMINAL_ROWS = 300;
export const MAX_TERMINAL_CELLS = 150_000;

export interface TerminalGrid {
  cols: number;
  rows: number;
}

export function isValidTerminalGrid(value: unknown): value is TerminalGrid {
  if (!value || typeof value !== "object") return false;
  const { cols, rows } = value as Partial<TerminalGrid>;
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols! >= MIN_TERMINAL_COLS &&
    cols! <= MAX_TERMINAL_COLS &&
    rows! >= MIN_TERMINAL_ROWS &&
    rows! <= MAX_TERMINAL_ROWS &&
    cols! * rows! <= MAX_TERMINAL_CELLS
  );
}

/** Fit results are bounded before they reach Ghostty or the PTY. */
export function clampTerminalGrid(cols: number, rows: number): TerminalGrid {
  let safeCols = Math.min(MAX_TERMINAL_COLS, Math.max(MIN_TERMINAL_COLS, Math.floor(cols)));
  let safeRows = Math.min(MAX_TERMINAL_ROWS, Math.max(MIN_TERMINAL_ROWS, Math.floor(rows)));

  if (safeCols * safeRows > MAX_TERMINAL_CELLS) {
    safeRows = Math.max(MIN_TERMINAL_ROWS, Math.floor(MAX_TERMINAL_CELLS / safeCols));
  }

  return { cols: safeCols, rows: safeRows };
}
