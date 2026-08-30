import assert from "node:assert/strict";
import test from "node:test";
import {
  assignMonitorTerminal,
  normalizeMonitorWorkspace,
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
