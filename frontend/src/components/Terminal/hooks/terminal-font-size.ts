import {
  DEFAULT_FONT_SCALE,
  normalizeFontScale,
} from "../../../lib/font-scale";

const DESKTOP_TERMINAL_FONT_SIZE = 16;
const MOBILE_TERMINAL_FONT_SIZE = 13;

export function getTerminalFontSize(
  isMobile: boolean,
  fontScale = DEFAULT_FONT_SCALE
): number {
  const baseSize = isMobile
    ? MOBILE_TERMINAL_FONT_SIZE
    : DESKTOP_TERMINAL_FONT_SIZE;
  return baseSize * normalizeFontScale(fontScale);
}
