import assert from "node:assert/strict";
import test from "node:test";
import {
  assignMonitorTerminal,
  dropMonitorTerminal,
  dropSideFromRatio,
  moveMonitorPane,
  normalizeMonitorWorkspace,
  openMonitorTerminal,
  renameMonitorTerminal,
  removeMonitorPane,
} from "./monitor-workspace";

test("normalizes one to five ordered pane widths", () => {
  const state = normalizeMonitorWorkspace({
    panes: [
      { id: "left", terminalId: "term-a", width: 25 },
      { id: "right", terminalId: "term-b", width: 75 },
    ],
  });
  assert.deepEqual(
    state.panes.map((pane) => pane.id),
    ["left", "right"]
  );
  assert.deepEqual(
    state.panes.map((pane) => pane.width),
    [0.5, 0.5]
  );
  const five = normalizeMonitorWorkspace({
    panes: Array.from({ length: 5 }, (_, index) => ({
      id: `pane-${index}`,
      terminalId: `term-${index}`,
      width: index + 1,
    })),
  });
  assert.equal(five.panes.length, 5);
  assert.deepEqual(
    five.panes.map((pane) => pane.width),
    Array(5).fill(0.2)
  );
});

test("rejects invalid counts, widths, and duplicate identities", () => {
  assert.throws(() => normalizeMonitorWorkspace({ panes: [] }));
  assert.throws(
    () =>
      normalizeMonitorWorkspace({
        panes: Array.from({ length: 6 }, (_, index) => ({
          id: `pane-${index}`,
          terminalId: null,
          width: 1,
        })),
      }),
    /one to five panes/
  );
  assert.throws(() =>
    normalizeMonitorWorkspace({
      panes: [{ id: "a", terminalId: null, width: 0 }],
    })
  );
  assert.throws(() =>
    normalizeMonitorWorkspace({
      panes: [
        { id: "a", terminalId: "same", width: 1 },
        { id: "b", terminalId: "same", width: 1 },
      ],
    })
  );
  assert.throws(
    () =>
      normalizeMonitorWorkspace({
        panes: [
          { id: "dup", terminalId: "one", width: 1 },
          { id: "dup", terminalId: "two", width: 1 },
        ],
      }),
    /Duplicate pane id/
  );
});

test("duplicate assignment is prevented while replacement is allowed", () => {
  const state = normalizeMonitorWorkspace({
    panes: [
      { id: "a", terminalId: "one", width: 1 },
      { id: "b", terminalId: null, width: 1 },
    ],
  });
  assert.equal(assignMonitorTerminal(state, "b", "one"), state);
  assert.equal(
    assignMonitorTerminal(state, "b", "two").panes[1].terminalId,
    "two"
  );
});

test("removeMonitorPane drops a chosen pane and renormalizes remaining widths", () => {
  const state = normalizeMonitorWorkspace({
    panes: [
      { id: "left", terminalId: "term-a", width: 1 },
      { id: "middle", terminalId: "term-b", width: 1 },
      { id: "right", terminalId: "term-c", width: 1 },
    ],
  });
  const removed = removeMonitorPane(state, "left");
  assert.deepEqual(
    removed.panes.map((pane) => pane.id),
    ["middle", "right"]
  );
  assert.deepEqual(
    removed.panes.map((pane) => pane.width),
    [0.5, 0.5]
  );
  assert.equal(removeMonitorPane(removed, "missing"), removed);
  const last = removeMonitorPane(removed, "middle");
  assert.equal(last.panes.length, 1);
  assert.equal(removeMonitorPane(last, "right"), last);
});

test("dropSideFromRatio maps the outer quarters to edges", () => {
  assert.equal(dropSideFromRatio(0.1), "before");
  assert.equal(dropSideFromRatio(0.5), "center");
  assert.equal(dropSideFromRatio(0.9), "after");
});

test("edge drop inserts beside an occupied pane and steals an already-monitored terminal", () => {
  const state = normalizeMonitorWorkspace({
    panes: [
      { id: "left", terminalId: "term-a", width: 1 },
      { id: "right", terminalId: "term-b", width: 1 },
    ],
  });
  const inserted = dropMonitorTerminal(state, "right", "term-c", "before");
  assert.deepEqual(
    inserted.panes.map((pane) => pane.terminalId),
    ["term-a", "term-c", "term-b"]
  );
  const stolen = dropMonitorTerminal(state, "right", "term-a", "after");
  assert.deepEqual(
    stolen.panes.map((pane) => pane.terminalId),
    ["term-b", "term-a"]
  );
});

test("center drop replaces and steals without adding a pane", () => {
  const state = normalizeMonitorWorkspace({
    panes: [
      { id: "left", terminalId: "term-a", width: 1 },
      { id: "right", terminalId: "term-b", width: 1 },
    ],
  });
  const replaced = dropMonitorTerminal(state, "right", "term-c", "center");
  assert.deepEqual(
    replaced.panes.map((pane) => pane.terminalId),
    ["term-a", "term-c"]
  );
  const stolen = dropMonitorTerminal(state, "right", "term-a", "center");
  assert.deepEqual(
    stolen.panes.map((pane) => pane.terminalId),
    [null, "term-a"]
  );
});

test("edge drop adds a fifth pane, then replaces when full", () => {
  const state = normalizeMonitorWorkspace({
    panes: [
      { id: "a", terminalId: "term-a", width: 1 },
      { id: "b", terminalId: "term-b", width: 1 },
      { id: "c", terminalId: "term-c", width: 1 },
      { id: "d", terminalId: "term-d", width: 1 },
    ],
  });
  const expanded = dropMonitorTerminal(state, "b", "term-e", "before");
  assert.equal(expanded.panes.length, 5);
  assert.deepEqual(
    expanded.panes.map((pane) => pane.width),
    Array(5).fill(0.2)
  );
  const replaced = dropMonitorTerminal(expanded, "b", "term-f", "before");
  assert.equal(replaced.panes.length, 5);
  assert.deepEqual(
    replaced.panes.map((pane) => pane.terminalId),
    ["term-a", "term-e", "term-f", "term-c", "term-d"]
  );
});

test("empty pane drops assign that pane instead of inserting", () => {
  const state = normalizeMonitorWorkspace({
    panes: [{ id: "only", terminalId: null, width: 1 }],
  });
  const assigned = dropMonitorTerminal(state, "only", "term-a", "before");
  assert.equal(assigned.panes.length, 1);
  assert.equal(assigned.panes[0].terminalId, "term-a");
});

test("moveMonitorPane reorders and ignores a self drop", () => {
  const state = normalizeMonitorWorkspace({
    panes: [
      { id: "left", terminalId: "term-a", width: 1 },
      { id: "middle", terminalId: "term-b", width: 1 },
      { id: "right", terminalId: "term-c", width: 1 },
    ],
  });
  assert.deepEqual(
    moveMonitorPane(state, "left", "right", "after").panes.map(
      (pane) => pane.id
    ),
    ["middle", "right", "left"]
  );
  assert.deepEqual(
    moveMonitorPane(state, "right", "left", "before").panes.map(
      (pane) => pane.id
    ),
    ["right", "left", "middle"]
  );
  assert.equal(moveMonitorPane(state, "left", "left", "after"), state);
});

test("ignores the legacy enabled flag in stored layouts", () => {
  const state = normalizeMonitorWorkspace({
    enabled: false,
    panes: [{ id: "only", terminalId: null, width: 1 }],
  });
  assert.deepEqual(state, {
    panes: [{ id: "only", terminalId: null, width: 1 }],
  });
});

test("opening a terminal reuses its pane, then an empty pane, then adds one", () => {
  const shown = {
    panes: [
      { id: "a", terminalId: "t1", width: 0.5 },
      { id: "b", terminalId: null, width: 0.5 },
    ],
  };
  assert.equal(openMonitorTerminal(shown, "t1"), shown);
  assert.equal(openMonitorTerminal(shown, "t2").panes[1].terminalId, "t2");

  const full = openMonitorTerminal(openMonitorTerminal(shown, "t2"), "t3");
  assert.deepEqual(
    full.panes.map((pane) => pane.terminalId),
    ["t1", "t2", "t3"]
  );
});

test("a renamed terminal stays in its pane", () => {
  const state = {
    panes: [{ id: "a", terminalId: "old", width: 1 }],
  };
  assert.equal(
    renameMonitorTerminal(state, "old", "new").panes[0].terminalId,
    "new"
  );
  assert.equal(renameMonitorTerminal(state, "other", "new"), state);
});
