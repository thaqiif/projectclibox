import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalKeySequence } from "../terminal-key-sequences";

const plain = { shift: false, ctrl: false, alt: false };

test("Shift combines with arrows and other terminal navigation keys", () => {
  assert.equal(terminalKeySequence("ArrowLeft", plain), "\x1b[D");
  assert.equal(
    terminalKeySequence("ArrowLeft", { ...plain, shift: true }),
    "\x1b[1;2D"
  );
  assert.equal(
    terminalKeySequence("ArrowUp", { shift: true, ctrl: true, alt: true }),
    "\x1b[1;8A"
  );
  assert.equal(terminalKeySequence("Tab", { ...plain, shift: true }), "\x1b[Z");
  assert.equal(terminalKeySequence("Enter", { ...plain, shift: true }), "\n");
  assert.equal(
    terminalKeySequence("Delete", { ...plain, shift: true }),
    "\x1b[3;2~"
  );
});

test("virtual Shift, Ctrl, and Alt also encode printable keys", () => {
  assert.equal(terminalKeySequence("a", { ...plain, shift: true }), "A");
  assert.equal(terminalKeySequence("1", { ...plain, shift: true }), "!");
  assert.equal(terminalKeySequence("c", { ...plain, ctrl: true }), "\x03");
  assert.equal(
    terminalKeySequence("c", { shift: true, ctrl: true, alt: true }),
    "\x1b\x03"
  );
  assert.equal(terminalKeySequence("Enter", { ...plain, alt: true }), "\x1b\r");
  assert.equal(terminalKeySequence("ControlC", plain), "\x03");
  assert.equal(terminalKeySequence("Newline", plain), "\x1b\r");
});
