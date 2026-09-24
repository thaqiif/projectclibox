import assert from "node:assert/strict";
import test from "node:test";
import { clampTerminalGrid, isValidTerminalGrid } from "./terminal-grid";

test("terminal grid validation enforces integer ranges and cell budget", () => {
  assert.equal(isValidTerminalGrid({ cols: 80, rows: 24 }), true);
  assert.equal(isValidTerminalGrid({ cols: 0, rows: 24 }), false);
  assert.equal(isValidTerminalGrid({ cols: 501, rows: 24 }), false);
  assert.equal(isValidTerminalGrid({ cols: 80, rows: 301 }), false);
  assert.equal(isValidTerminalGrid({ cols: 500, rows: 301 }), false);
  assert.equal(isValidTerminalGrid({ cols: 80.5, rows: 24 }), false);
});

test("fitted dimensions stay within the server contract", () => {
  const grid = clampTerminalGrid(900, 900);
  assert.equal(isValidTerminalGrid(grid), true);
  assert.deepEqual(grid, { cols: 500, rows: 300 });
});
