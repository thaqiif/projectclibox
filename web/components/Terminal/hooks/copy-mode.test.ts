import assert from "node:assert/strict";
import { test } from "node:test";
import { createCopyModeExit, readCopyModePosition } from "./copy-mode";

test("reads tmux's copy-mode indicator from the top row", () => {
  assert.deepEqual(readCopyModePosition("line 12        [3/270]"), {
    position: 3,
    history: 270,
  });
  // tmux 3.4 prefixes the time of the top line.
  assert.deepEqual(readCopyModePosition("12 (10:32:01) [0/5]  "), {
    position: 0,
    history: 5,
  });
  assert.equal(readCopyModePosition("root@vm:~# ls"), null);
  assert.equal(readCopyModePosition("[9/3]"), null);
});

function createElement(topRow: string) {
  const listeners = new Map<string, () => void>();
  const row = { textContent: topRow };
  const element = {
    addEventListener: (name: string, listener: () => void) =>
      listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
    querySelector: () => row,
  };
  return { element: element as unknown as HTMLElement, listeners, row };
}

test("typing after a scroll leaves copy mode first", () => {
  const { element, listeners } = createElement("line 1      [4/100]");
  const exit = createCopyModeExit(element);
  listeners.get("wheel")?.();
  assert.equal(exit.prefixFor("g"), "q");
  // Once is enough: the next key is already at the prompt.
  assert.equal(exit.prefixFor("i"), "");
});

test("paging, mouse and focus reports keep copy mode", () => {
  const { element, listeners } = createElement("line 1      [4/100]");
  const exit = createCopyModeExit(element);
  listeners.get("wheel")?.();
  for (const data of ["\x1b[5~", "\x1b[6~", "\x1b[<64;1;1M", "\x1b[I"]) {
    assert.equal(exit.prefixFor(data), "");
  }
  assert.equal(exit.prefixFor("\r"), "q");
});

test("text that only looks like the indicator never gets a stray q", () => {
  // No wheel gesture happened, so this is shell output, not copy mode.
  const { element } = createElement("building        [3/10]");
  const exit = createCopyModeExit(element);
  assert.equal(exit.prefixFor("x"), "");
});
