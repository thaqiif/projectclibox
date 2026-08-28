import assert from "node:assert/strict";
import test from "node:test";
import { getTerminalFontSize } from "./terminal-font-size";

test("scales the desktop TUI font from its base size", () => {
  assert.equal(getTerminalFontSize(false, 1.2), 19.2);
});

test("scales the mobile TUI font from its mobile base size", () => {
  assert.equal(getTerminalFontSize(true, 0.8), 10.4);
});
