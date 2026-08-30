import assert from "node:assert/strict";
import test from "node:test";
import {
  assignMonitorTerminal,
  normalizeMonitorWorkspace,
  removeMonitorPane,
} from "./monitor-workspace";

test("normalizes one to three ordered pane widths", () => {
  const state = normalizeMonitorWorkspace({
    enabled: true,
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
    [0.25, 0.75]
  );
});

test("rejects invalid counts, widths, and duplicate identities", () => {
  assert.throws(() => normalizeMonitorWorkspace({ enabled: true, panes: [] }));
  assert.throws(() =>
    normalizeMonitorWorkspace({
      enabled: true,
      panes: [{ id: "a", terminalId: null, width: 0 }],
    })
  );
  assert.throws(() =>
    normalizeMonitorWorkspace({
      enabled: true,
      panes: [
        { id: "a", terminalId: "same", width: 1 },
        { id: "b", terminalId: "same", width: 1 },
      ],
    })
  );
  assert.throws(
    () =>
      normalizeMonitorWorkspace({
        enabled: true,
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
    enabled: true,
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
    enabled: true,
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
