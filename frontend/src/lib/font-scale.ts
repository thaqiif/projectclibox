export const DEFAULT_FONT_SCALE = 1;

/** Keep invalid persisted values from producing an unusable font size. */
export function normalizeFontScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_FONT_SCALE;
}
