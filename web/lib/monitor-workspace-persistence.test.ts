import "./monitor-workspace-test-db";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, PUT } from "../app/api/monitor-workspace/route";
import { getDb, queries } from "../lib/db";
import {
  DEFAULT_MONITOR_WORKSPACE,
  MONITOR_WORKSPACE_SETTING_KEY,
  assignMonitorTerminal,
  normalizeMonitorWorkspace,
  type MonitorWorkspaceState,
} from "../lib/monitor-workspace";
import { MONITOR_WORKSPACE_TEST_DB_DIRECTORY } from "./monitor-workspace-test-db";

function putRequest(payload: unknown): NextRequest {
  return new NextRequest("http://localhost/api/monitor-workspace", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function getBody(): Promise<MonitorWorkspaceState> {
  const response = await GET();
  assert.equal(response.status, 200);
  return (await response.json()) as MonitorWorkspaceState;
}

function readStoredRaw(): string | undefined {
  const row = queries.getSetting(getDb()).get(MONITOR_WORKSPACE_SETTING_KEY) as
    | { value: string }
    | undefined;
  return row?.value;
}

/** Remove any stored workspace so each test starts from a blank slate. */
function resetSettings(): void {
  getDb().prepare("DELETE FROM settings").run();
}

test("persistence tests run against the isolated temp database", () => {
  const { join } = require("node:path") as typeof import("node:path");
  const expected = join(MONITOR_WORKSPACE_TEST_DB_DIRECTORY, "clibox.db");
  assert.equal(process.env.DB_PATH, expected);
  const name = getDb().prepare("PRAGMA database_list").get() as {
    file: string;
  };
  assert.equal(name.file, expected);
});

const TWO_PANE_WORKSPACE = {
  panes: [
    { id: "monitor-left", terminalId: "term-alpha", width: 1 },
    { id: "monitor-right", terminalId: "term-beta", width: 3 },
  ],
};

test("PUT and GET preserve a five-pane monitor workspace", async () => {
  resetSettings();
  const panes = Array.from({ length: 5 }, (_, index) => ({
    id: `monitor-${index}`,
    terminalId: `term-${index}`,
    width: 1,
  }));
  const response = await PUT(putRequest({ panes }));
  assert.equal(response.status, 200);
  const expected = normalizeMonitorWorkspace({ panes });
  assert.deepEqual(await response.json(), expected);
  assert.deepEqual(await getBody(), expected);
});

test("GET returns the default workspace when nothing is stored", async () => {
  resetSettings();

  const state = await getBody();

  assert.deepEqual(state, DEFAULT_MONITOR_WORKSPACE);
  assert.deepEqual(state.panes, [
    { id: "monitor-1", terminalId: null, width: 1 },
  ]);
});

test("PUT persists pane order, terminal identities, and equal pane widths", async () => {
  resetSettings();

  const response = await PUT(
    putRequest({
      panes: [
        { id: "monitor-left", terminalId: "term-alpha", width: 1 },
        { id: "monitor-right", terminalId: "term-beta", width: 3 },
      ],
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    panes: [
      { id: "monitor-left", terminalId: "term-alpha", width: 0.5 },
      { id: "monitor-right", terminalId: "term-beta", width: 0.5 },
    ],
  });

  // Stored widths are equal shares, independent of the submitted 1:3 ratio.
  assert.deepEqual(JSON.parse(readStoredRaw()!), {
    panes: [
      { id: "monitor-left", terminalId: "term-alpha", width: 0.5 },
      { id: "monitor-right", terminalId: "term-beta", width: 0.5 },
    ],
  });

  // GET serves the persisted, equal-width state back.
  assert.deepEqual(await getBody(), {
    panes: [
      { id: "monitor-left", terminalId: "term-alpha", width: 0.5 },
      { id: "monitor-right", terminalId: "term-beta", width: 0.5 },
    ],
  });
});

test("PUT rejects invalid workspaces with 400 without touching stored state", async () => {
  resetSettings();
  await PUT(putRequest(TWO_PANE_WORKSPACE));
  const storedBefore = readStoredRaw();

  const invalidPayloads: Array<[string, unknown]> = [
    ["empty panes array", { panes: [] }],
    [
      "zero width",
      {
        panes: [
          { id: "a", terminalId: "term-alpha", width: 0 },
          { id: "b", terminalId: null, width: 1 },
        ],
      },
    ],
    [
      "negative width",
      {
        panes: [
          { id: "a", terminalId: "term-alpha", width: -0.5 },
          { id: "b", terminalId: null, width: 1 },
        ],
      },
    ],
    [
      "non-numeric width",
      {
        panes: [
          { id: "a", terminalId: "term-alpha", width: "half" },
          { id: "b", terminalId: null, width: 1 },
        ],
      },
    ],
    [
      "duplicate terminalId across panes",
      {
        panes: [
          { id: "a", terminalId: "term-alpha", width: 1 },
          { id: "b", terminalId: "term-alpha", width: 1 },
        ],
      },
    ],
    [
      "duplicate pane ids",
      {
        panes: [
          { id: "monitor-left", terminalId: "term-alpha", width: 1 },
          { id: "monitor-left", terminalId: "term-beta", width: 1 },
        ],
      },
    ],
    [
      "six panes",
      {
        panes: [
          { id: "a", terminalId: null, width: 1 },
          { id: "b", terminalId: null, width: 1 },
          { id: "c", terminalId: null, width: 1 },
          { id: "d", terminalId: null, width: 1 },
          { id: "e", terminalId: null, width: 1 },
          { id: "f", terminalId: null, width: 1 },
        ],
      },
    ],
  ];

  for (const [label, payload] of invalidPayloads) {
    const response = await PUT(putRequest(payload));
    assert.equal(
      response.status,
      400,
      `expected 400 for ${label}, got ${response.status}`
    );
    const body = (await response.json()) as { error?: string };
    assert.equal(typeof body.error, "string", `${label}: error message set`);
    assert.equal(
      readStoredRaw(),
      storedBefore,
      `${label}: stored state must be untouched by a rejected PUT`
    );
  }
});

test("PUT accepts a legacy enabled flag and does not store it", async () => {
  resetSettings();
  await PUT(putRequest(TWO_PANE_WORKSPACE));

  const response = await PUT(
    putRequest({
      enabled: false,
      panes: [
        { id: "monitor-left", terminalId: "term-alpha", width: 0.5 },
        { id: "monitor-right", terminalId: "term-beta", width: 0.5 },
      ],
    })
  );
  assert.equal(response.status, 200);

  const state = await getBody();
  assert.equal("enabled" in state, false);
  assert.deepEqual(state.panes, [
    { id: "monitor-left", terminalId: "term-alpha", width: 0.5 },
    { id: "monitor-right", terminalId: "term-beta", width: 0.5 },
  ]);
});

test("last write wins: the second of two valid PUTs is the canonical stored value", async () => {
  resetSettings();

  const first = await PUT(
    putRequest({
      panes: [{ id: "monitor-1", terminalId: "term-alpha", width: 1 }],
    })
  );
  assert.equal(first.status, 200);

  const second = await PUT(
    putRequest({
      panes: [
        { id: "monitor-a", terminalId: "term-beta", width: 2 },
        { id: "monitor-b", terminalId: null, width: 2 },
      ],
    })
  );
  assert.equal(second.status, 200);

  // GET serves the second write, not the first.
  assert.deepEqual(await getBody(), {
    panes: [
      { id: "monitor-a", terminalId: "term-beta", width: 0.5 },
      { id: "monitor-b", terminalId: null, width: 0.5 },
    ],
  });
  // And the stored row is exactly the second write.
  assert.deepEqual(JSON.parse(readStoredRaw()!), {
    panes: [
      { id: "monitor-a", terminalId: "term-beta", width: 0.5 },
      { id: "monitor-b", terminalId: null, width: 0.5 },
    ],
  });
});

test("GET falls back to the default workspace when the stored value is corrupt", async () => {
  resetSettings();
  queries.setSetting(getDb()).run(MONITOR_WORKSPACE_SETTING_KEY, '{"panes": [');

  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), DEFAULT_MONITOR_WORKSPACE);

  // The corrupt value is self-healed back to the default on disk.
  assert.deepEqual(JSON.parse(readStoredRaw()!), DEFAULT_MONITOR_WORKSPACE);
});

test("a saved pane referencing an unavailable terminal is kept as-is by the model", () => {
  const saved: MonitorWorkspaceState = {
    panes: [
      { id: "monitor-left", terminalId: "gone-terminal", width: 0.5 },
      { id: "monitor-right", terminalId: "term-beta", width: 0.5 },
    ],
  };

  // The live terminal list no longer contains "gone-terminal".
  const liveTerminalIds = new Set(["term-beta"]);

  // Re-normalizing the saved state with unavailable terminals present must
  // not remove, reorder, resize, or reassign any pane.
  const normalized = normalizeMonitorWorkspace(
    JSON.parse(JSON.stringify(saved))
  );
  assert.deepEqual(normalized.panes, saved.panes);
  const unavailablePane = normalized.panes.find(
    (pane) => !liveTerminalIds.has(pane.terminalId ?? "")
  );
  assert.deepEqual(unavailablePane, {
    id: "monitor-left",
    terminalId: "gone-terminal",
    width: 0.5,
  });
});

test("assignMonitorTerminal replaces an unavailable terminal's pane but still rejects duplicate assignment", () => {
  const saved: MonitorWorkspaceState = {
    panes: [
      { id: "monitor-left", terminalId: "gone-terminal", width: 0.5 },
      { id: "monitor-right", terminalId: "term-beta", width: 0.5 },
    ],
  };

  // Replacing the pane that references the unavailable terminal succeeds and
  // only changes that pane's terminalId.
  const replaced = assignMonitorTerminal(saved, "monitor-left", "term-gamma");
  assert.deepEqual(replaced.panes, [
    { id: "monitor-left", terminalId: "term-gamma", width: 0.5 },
    { id: "monitor-right", terminalId: "term-beta", width: 0.5 },
  ]);

  // Assigning "term-beta" (already on another pane) to monitor-left is a
  // no-op: the same state object comes back unchanged.
  assert.equal(
    assignMonitorTerminal(saved, "monitor-left", "term-beta"),
    saved
  );
});

test("per-pane failure isolation is a component-level behavior, not a pure-model one", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const source = readFileSync(
    join(__dirname, "../components/MonitorWorkspace/index.tsx"),
    "utf8"
  );
  // Each pane still maps to its own MonitorTerminal keyed by that pane's
  // terminal identity, so one pane's restart/placeholder path cannot reuse
  // another pane's connection.
  assert.match(source, /workspace\.panes\.map\(/);
  assert.match(source, /key=\{terminal\.id\}/);
  assert.match(source, /key=\{terminalId\}/);

  const saved: MonitorWorkspaceState = {
    panes: [
      { id: "monitor-left", terminalId: "gone-terminal", width: 0.5 },
      { id: "monitor-right", terminalId: "term-beta", width: 0.5 },
    ],
  };
  const normalized = normalizeMonitorWorkspace(saved);
  // The healthy pane is unaffected by the broken pane next to it.
  assert.deepEqual(normalized.panes[1], {
    id: "monitor-right",
    terminalId: "term-beta",
    width: 0.5,
  });
});

process.on("exit", () => {
  try {
    rmSync(MONITOR_WORKSPACE_TEST_DB_DIRECTORY, {
      recursive: true,
      force: true,
    });
  } catch {}
});
