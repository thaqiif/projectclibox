import assert from "node:assert/strict";
import { test } from "node:test";
import { createNativePanes, type NativePane } from "./native-panes";
import { createTuiPan, detectPaneShift } from "./tui-pan";

const chat = (position: number): NativePane => ({
  kind: "chat",
  x: 0,
  y: 1,
  width: 40,
  height: 10,
  position,
  content_length: 100,
  viewport_length: 10,
});

test("finds the pane under a cell, or the chat outside every pane", () => {
  const panes = createNativePanes();
  assert.equal(panes.paneAt(3, 3), null);
  panes.update([chat(50)]);
  const inside = panes.paneAt(3, 3);
  assert.deepEqual(
    [inside?.top, inside?.bottom, inside?.left, inside?.right],
    [1, 10, 0, 39]
  );
  // A swipe on the header or input box scrolls the chat.
  assert.equal(panes.paneAt(0, 3)?.top, 1);
});

test("counts rows from the mark and knows both ends", () => {
  const panes = createNativePanes();
  const sent: Array<[string, number]> = [];
  panes.setSender((pane, delta) => sent.push([pane, delta]));
  panes.update([chat(50)]);
  const pane = panes.paneAt(3, 3)!;
  pane.mark();
  assert.deepEqual(pane.limits(), { older: 50, newer: 40 });
  pane.scroll(3); // towards older: the app counts that as negative
  assert.deepEqual(sent, [["chat", -3]]);
  panes.update([chat(47)]);
  assert.equal(pane.moved(), 3);
  panes.update([]);
  assert.equal(pane.moved(), null);
});

test("a pinned header row does not stop a pane shift being read", () => {
  const rows = (top: number) => [
    "29> question 29",
    ...Array.from(
      { length: 8 },
      (_, i) => `L${String(top + i).padStart(4, "0")}`
    ),
  ];
  assert.deepEqual(detectPaneShift(rows(20), rows(17), 1), {
    rows: 3,
    top: 1,
    bottom: 0,
  });
  // A frame that is half old, half new is not a shift at all.
  const torn = [...rows(17).slice(0, 5), ...rows(20).slice(5)];
  assert.equal(detectPaneShift(rows(20), torn, 1), null);
});

test("native panes: one row per row of travel, never past the top", () => {
  const panes = createNativePanes();
  const sent: number[] = [];
  panes.setSender((_, delta) => sent.push(delta));
  panes.update([chat(2)]); // two rows from the top
  const rows = Array.from({ length: 12 }, (_, i) => ({
    textContent: `row ${i}`,
    style: {} as Record<string, string>,
  }));
  const grid = {
    style: {} as Record<string, string>,
    querySelectorAll: () => rows,
  };
  const element = {
    querySelector: () => grid,
    classList: { add() {}, remove() {}, contains: () => true },
  };
  const pan = createTuiPan({
    element: element as unknown as HTMLElement,
    sendWheel: () => assert.fail("native panes never use wheel reports"),
    requestFrame: () => 0,
    cancelFrame: () => {},
  });
  try {
    pan.begin(20, panes.paneAt(3, 3));
    pan.move(30); // 1.5 rows: asks for two (half a row early)
    pan.move(200); // far past the top: nothing more exists
    assert.equal(
      sent.reduce((sum, delta) => sum + delta, 0),
      -2
    );
  } finally {
    pan.dispose();
  }
});
