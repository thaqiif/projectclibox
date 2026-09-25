"use client";

/**
 * Release and momentum rules shared by every touch scroll path, tuned to
 * feel like a native iOS list:
 *
 * - Release speed comes from the finger's last ~100ms, not a running
 *   average, so slowing down to a stop reads as a stop.
 * - Only a real flick coasts; lifting a finger that has stopped, or was
 *   barely moving, leaves the view exactly where it is.
 * - Momentum ends once it is down to about a pixel per frame, instead of
 *   crawling the last few pixels for a second.
 */

/** Momentum decay; matches iOS's normal deceleration. */
export const MOMENTUM_TIME_CONSTANT_MS = 325;
/** Below this release speed (px/ms) there is no momentum at all. */
export const FLICK_MIN_VELOCITY = 0.25;
/** Momentum stops once this slow (px/ms, about a pixel per frame). */
export const MOMENTUM_STOP_VELOCITY = 0.06;
/** A finger still this long before lifting has stopped, whatever came before. */
const RELEASE_STILL_MS = 40;
const SAMPLE_WINDOW_MS = 150;
// Release speed is measured over this last stretch of the gesture.
const RELEASE_WINDOW_MS = 60;

export interface VelocityTracker {
  reset(): void;
  add(time: number, position: number): void;
  /** px/ms at release, or 0 when the gesture ended as a stop. */
  release(time: number): number;
}

export function createVelocityTracker(): VelocityTracker {
  let samples: Array<{ time: number; position: number }> = [];
  return {
    reset() {
      samples = [];
    },
    add(time, position) {
      samples.push({ time, position });
      while (samples.length > 2 && time - samples[0].time > SAMPLE_WINDOW_MS) {
        samples.shift();
      }
    },
    release(time) {
      const last = samples[samples.length - 1];
      if (!last || time - last.time > RELEASE_STILL_MS) return 0;
      // Distance covered in the window that ends at the release, so a pause
      // just before lifting counts as stillness, not as the earlier speed.
      const anchor =
        [...samples]
          .reverse()
          .find((s) => time - s.time >= RELEASE_WINDOW_MS) ?? samples[0];
      const elapsed = time - anchor.time;
      if (elapsed < 8) return 0;
      // The longer the finger has been still, the less of that speed is
      // meant: it fades to nothing over RELEASE_STILL_MS.
      let moving = samples.length - 1;
      while (
        moving > 0 &&
        samples[moving].position === samples[moving - 1].position
      ) {
        moving -= 1;
      }
      const stillFor = time - samples[moving].time;
      const velocity =
        ((last.position - anchor.position) / elapsed) *
        Math.max(0, 1 - stillFor / RELEASE_STILL_MS);
      return Math.abs(velocity) < FLICK_MIN_VELOCITY ? 0 : velocity;
    },
  };
}
