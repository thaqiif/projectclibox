import assert from "node:assert/strict";
import { test } from "node:test";
import { createVelocityTracker } from "./momentum";

const drag = (points: Array<[number, number]>) => {
  const tracker = createVelocityTracker();
  for (const [time, y] of points) tracker.add(time, y);
  return tracker;
};

test("a flick coasts at the finger's speed", () => {
  const tracker = drag([
    [0, 0],
    [16, 16],
    [32, 32],
    [48, 48],
  ]);
  const velocity = tracker.release(50);
  assert.ok(velocity > 0.9 && velocity <= 1, String(velocity));
});

test("a finger that stopped before lifting does not coast", () => {
  const tracker = drag([
    [0, 0],
    [16, 16],
    [32, 32],
  ]);
  assert.equal(tracker.release(32 + 60), 0);
});

test("slowing down to a stop reads as a stop, not the earlier speed", () => {
  const tracker = drag([
    [0, 0],
    [16, 30],
    [32, 60], // fast...
    [100, 62],
    [140, 63],
    [180, 63.5], // ...then nearly still for the last 100ms
  ]);
  assert.equal(tracker.release(185), 0);
});

test("a pause just before lifting means stop", () => {
  const tracker = drag([
    [0, 0],
    [16, 16],
    [32, 32],
    [48, 48],
    [64, 48], // still for the last 30ms
  ]);
  assert.equal(tracker.release(78), 0);
});

test("a slow deliberate drag does not coast", () => {
  const tracker = drag([
    [0, 0],
    [50, 5],
    [100, 10],
  ]);
  assert.equal(tracker.release(105), 0);
});
