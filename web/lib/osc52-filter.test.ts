import assert from "node:assert/strict";
import test from "node:test";
import { Osc52Filter } from "./osc52-filter";

test("OSC 52 writes are removed and decoded across output chunks", () => {
  const filter = new Osc52Filter();
  assert.deepEqual(filter.push("before\u001b]52;c;SGVsbG8g"), {
    terminalData: "before",
  });
  assert.deepEqual(filter.push("d29ybGQ=\u0007after"), {
    terminalData: "after",
    clipboardText: "Hello world",
  });
});

test("OSC 52 clipboard reads are removed without returning data", () => {
  const filter = new Osc52Filter();
  assert.deepEqual(filter.push("\u001b]52;c;?\u0007safe"), {
    terminalData: "safe",
  });
});

test("other OSC sequences pass through unchanged", () => {
  const filter = new Osc52Filter();
  assert.deepEqual(filter.push("\u001b]0;new title\u0007"), {
    terminalData: "\u001b]0;new title\u0007",
  });
});
