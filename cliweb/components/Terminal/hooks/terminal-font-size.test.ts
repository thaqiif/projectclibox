import assert from "node:assert/strict";
import test from "node:test";
import {
  getTerminalFontSize,
  getTerminalLineHeight,
  getTerminalRowHeight,
} from "./terminal-font-size";

test("scales the desktop TUI font from its base size", () => {
  assert.equal(getTerminalFontSize(false, 1.2), 19.2);
});

test("scales the mobile TUI font from its mobile base size", () => {
  assert.equal(getTerminalFontSize(true, 1.5), 21);
});

test("rows are tall enough for the font and its line height", () => {
  assert.equal(getTerminalRowHeight(16, getTerminalLineHeight(false)), 20);
  assert.equal(getTerminalRowHeight(14, getTerminalLineHeight(true)), 18);
  assert.equal(getTerminalRowHeight(16, 1.25), 20);
});
