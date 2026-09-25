import {
  DEFAULT_FONT_SCALE,
  normalizeFontScale,
} from "../../../lib/font-scale";

const DESKTOP_TERMINAL_FONT_SIZE = 16;
const MOBILE_TERMINAL_FONT_SIZE = 14;

export function getTerminalFontSize(
  isMobile: boolean,
  fontScale = DEFAULT_FONT_SCALE
): number {
  const baseSize = isMobile
    ? MOBILE_TERMINAL_FONT_SIZE
    : DESKTOP_TERMINAL_FONT_SIZE;
  return baseSize * normalizeFontScale(fontScale);
}

const DESKTOP_LINE_HEIGHT = 1.2;
// Phones read at arm's length with no zoom; a little more air between rows
// keeps dense TUI output legible.
const MOBILE_LINE_HEIGHT = 1.25;

export function getTerminalLineHeight(isMobile: boolean): number {
  return isMobile ? MOBILE_LINE_HEIGHT : DESKTOP_LINE_HEIGHT;
}

/**
 * Whole-pixel row height for a font size and line height.
 *
 * WTerm measures its row height from a probe row whose CSS height is
 * `--term-row-height` itself, so it only ever reads back whatever that
 * variable already holds (17px by default) regardless of font. The app sets
 * it from the font instead. Whole pixels keep rows from drifting apart.
 */
export function getTerminalRowHeight(
  fontSize: number,
  lineHeight: number
): number {
  return Math.ceil(fontSize * lineHeight - 0.001);
}
