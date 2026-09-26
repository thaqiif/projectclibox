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

test("WTerm rows preserve the production spacing at the saved 1.1x scale", () => {
  assert.equal(getTerminalRowHeight(17.6, getTerminalLineHeight(false)), 28);
  assert.equal(getTerminalRowHeight(15.4, getTerminalLineHeight(true)), 23);
  assert.equal(getTerminalRowHeight(14, getTerminalLineHeight(true)), 21);
  assert.equal(getTerminalRowHeight(16, 1.25), 20);
});
