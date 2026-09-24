/**
 * Select-all header checkbox helpers in file-bulk.ts: tri-state derivation
 * over the currently listed rows and the toggle behaviour (off -> select all
 * listed; mixed/on -> clear all).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  applySelectAllToggle,
  deriveSelectAllState,
} from "./file-bulk";

const listed = ["/proj/a.ts", "/proj/b.ts", "/proj/c.ts"];

test("deriveSelectAllState: empty listing is none, never all", () => {
  assert.equal(deriveSelectAllState([], new Set(listed)), "none");
});

test("deriveSelectAllState: none / some / all transitions", () => {
  assert.equal(deriveSelectAllState(listed, new Set()), "none");
  assert.equal(deriveSelectAllState(listed, new Set([listed[0]])), "some");
  assert.equal(deriveSelectAllState(listed, new Set(listed)), "all");
});

test("deriveSelectAllState: stale extra selections do not fake 'all'", () => {
  // A vanished path survives in the selection after refresh; the header
  // counts only LISTED rows, so:
  //  - a stale extra path alongside a full listed selection stays 'all';
  //  - a partially-covered listing stays 'some', never promoted to 'all'.
  const stale = new Set([listed[0], "/proj/gone.txt"]);
  assert.equal(deriveSelectAllState(listed, stale), "some");
  const fullPlusStale = new Set([...listed, "/proj/gone.txt"]);
  assert.equal(deriveSelectAllState(listed, fullPlusStale), "all");
  // Only the vanished path left selected over a fresh listing reads as none.
  assert.equal(deriveSelectAllState(listed, new Set(["/proj/gone.txt"])), "none");
});

test("applySelectAllToggle: unchecked selects exactly the listed rows", () => {
  const next = applySelectAllToggle(listed, new Set());
  assert.deepEqual([...next].sort(), [...listed].sort());
});

test("applySelectAllToggle: mixed clears everything", () => {
  const next = applySelectAllToggle(listed, new Set([listed[0]]));
  assert.equal(next.size, 0);
});

test("applySelectAllToggle: fully selected clears (not re-select)", () => {
  const next = applySelectAllToggle(listed, new Set(listed));
  assert.equal(next.size, 0);
});

test("applySelectAllToggle: clearing also drops stale vanished paths", () => {
  const stale = new Set([...listed, "/proj/gone.txt"]);
  const selected = applySelectAllToggle(listed, new Set(["/proj/gone.txt"]));
  assert.deepEqual([...selected].sort(), [...listed].sort());
  const cleared = applySelectAllToggle(listed, stale);
  assert.equal(cleared.size, 0);
});
