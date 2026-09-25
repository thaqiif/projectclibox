import assert from "node:assert/strict";
import { test } from "node:test";
import type { NativeScrollTarget } from "./native-panes";
import { looksTorn, nativeViewFor, openNativeView } from "./native-view";
import { detectPaneShift } from "./tui-pan";

test("a frame showing the same run of lines twice is half drawn", () => {
  const frame = [
    "header",
    "L0235 answer",
    "",
    "L0236 answer",
    "L0235 answer",
    "",
    "L0236 answer",
    "L0237 answer",
  ];
  assert.equal(looksTorn(frame, 1, frame.length), true);
});

test("a partly overwritten repeat still reads as half drawn", () => {
  const frame = [
    "L0263 answer 26 line 3 abcde",
    "L0264 answer 26 line 4 abcdef",
    "L0263 answer 26 line 3 ab",
    "L0264 answer 26 line 4 abcdef   ",
  ];
  assert.equal(looksTorn(frame, 0, frame.length), true);
});

test("ordinary content, blank lines included, is not half drawn", () => {
  const frame = ["one", "", "two", "", "", "three", "}", "four", "}"];
  assert.equal(looksTorn(frame, 0, frame.length), false);
});

test("known pinned rows are the only ones left out of a shift", () => {
  const before = ["head A", "a", "b", "c", "d", "e", "f"];
  // The header was redrawn along with a one-row scroll.
  const after = ["head B", "z", "a", "b", "c", "d", "e"];
  assert.deepEqual(detectPaneShift(before, after, 1, { top: 1, bottom: 0 }), {
    rows: 1,
    top: 1,
    bottom: 0,
  });
  // Row 1 redrawn as well: with one pinned row known, that is no scroll.
  const redrawn = ["head B", "y", "a", "b", "c", "d", "e"];
  assert.equal(
    detectPaneShift(["head A", "x", ...before.slice(2)], redrawn, 1, {
      top: 1,
      bottom: 0,
    }),
    null
  );
});

class FakeNode {
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  style: Record<string, string> = {};
  className = "";
  innerHTML = "";
  textContent = "";
  offsetTop = 0;
  offsetLeft = 0;
  clientWidth = 400;
  ownerDocument = {
    createElement: () => new FakeNode(),
  };
  appendChild(child: FakeNode) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
}

function createTerminal(lines: string[]) {
  const element = new FakeNode();
  const grid = new FakeNode();
  const rows = lines.map((text) => {
    const row = new FakeNode();
    row.textContent = text;
    row.innerHTML = text;
    return row;
  });
  Object.assign(grid, { querySelectorAll: () => rows });
  Object.assign(element, {
    querySelector: (selector: string) =>
      selector === ".term-grid" ? grid : null,
  });
  return { element, rows };
}

function createPane(height: number, older: number) {
  const sent: number[] = [];
  let moved = 0;
  const pane: NativeScrollTarget = {
    top: 0,
    bottom: height - 1,
    left: 0,
    right: 20,
    mark() {},
    moved: () => moved,
    limits: () => ({ older, newer: 0 }),
    scroll(lines) {
      sent.push(lines);
    },
  };
  return { pane, sent, setMoved: (value: number) => (moved = value) };
}

function frames() {
  const queue: Array<(time: number) => void> = [];
  let time = 0;
  return {
    requestFrame: (callback: (time: number) => void) => queue.push(callback),
    cancelFrame: () => {},
    now: () => time,
    run(limit = 200) {
      for (let i = 0; i < limit && queue.length; i += 1) {
        time += 16;
        queue.shift()!(time);
      }
    },
  };
}

test("the view opens showing the screen and asks for rows ahead", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const { element } = createTerminal(lines);
  const { pane, sent } = createPane(10, 100);
  const clock = frames();
  const view = openNativeView(element as unknown as HTMLElement, pane, 20, {
    ...clock,
  });
  assert.ok(view);
  const overlay = element.children.find((c) => c.className === "native-view");
  assert.ok(overlay);
  const shown = overlay.children[0].children
    .filter((row) => row.style.top !== "-100000px")
    .map((row) => row.innerHTML);
  assert.ok(shown.includes("line 0") && shown.includes("line 9"));

  // Two rows of finger travel towards older output: the app is asked for
  // those rows and more, before the finger gets there.
  view.move(40);
  assert.ok(sent.reduce((a, b) => a + b, 0) >= 2);
  view.dispose();
  assert.equal(nativeViewFor(element as unknown as HTMLElement), null);
});

test("a tap without moving hands straight back to the terminal", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const { element } = createTerminal(lines);
  const { pane, sent } = createPane(10, 100);
  const clock = frames();
  const view = openNativeView(element as unknown as HTMLElement, pane, 20, {
    ...clock,
  });
  assert.ok(view);
  view.fling(0);
  clock.run();
  assert.deepEqual(sent, []);
  assert.equal(
    element.children.some((c) => c.className === "native-view"),
    false
  );
});

test("a flick glides onto a whole row without passing the oldest one", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const { element } = createTerminal(lines);
  const { pane, sent } = createPane(10, 3);
  const clock = frames();
  const view = openNativeView(element as unknown as HTMLElement, pane, 20, {
    ...clock,
  });
  assert.ok(view);
  view.fling(2);
  clock.run();
  // Only three older rows exist: exactly that much is asked for.
  assert.equal(
    sent.reduce((a, b) => a + b, 0),
    3
  );
  const overlay = element.children.find((c) => c.className === "native-view");
  assert.equal(overlay?.children[0].style.transform, "translate3d(0, 60px, 0)");
  view.dispose();
});
