import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePaneSnapshot, parseScrollRequest } from "./native-scroll";

test("accepts jcode's pane snapshots", () => {
  const panes = parsePaneSnapshot(
    JSON.stringify({
      type: "pane_snapshot",
      panes: [
        {
          kind: "chat",
          x: 0,
          y: 0,
          width: 46,
          height: 31,
          position: 648,
          content_length: 679,
          viewport_length: 31,
        },
      ],
    })
  );
  assert.equal(panes?.[0].position, 648);
});

test("rejects anything that is not a well-formed snapshot", () => {
  assert.equal(parsePaneSnapshot("not json"), null);
  assert.equal(parsePaneSnapshot('{"type":"scroll"}'), null);
  assert.equal(
    parsePaneSnapshot(
      '{"type":"pane_snapshot","panes":[{"kind":"chat","x":-1,"y":0,"width":1,"height":1,"position":0,"content_length":1,"viewport_length":1}]}'
    ),
    null
  );
  assert.equal(
    parsePaneSnapshot(
      '{"type":"pane_snapshot","panes":[{"kind":"other","x":0,"y":0,"width":1,"height":1,"position":0,"content_length":1,"viewport_length":1}]}'
    ),
    null
  );
});

test("validates browser scroll requests", () => {
  assert.deepEqual(parseScrollRequest({ pane: "chat", delta: -3 }), {
    pane: "chat",
    delta: -3,
  });
  assert.equal(parseScrollRequest({ pane: "chat", delta: 0 }), null);
  assert.equal(parseScrollRequest({ pane: "chat", delta: 1.5 }), null);
  assert.equal(parseScrollRequest({ pane: "other", delta: 1 }), null);
  assert.equal(parseScrollRequest({ pane: "chat", delta: 1e9 }), null);
});

import { parsePaneState } from "./tmux-history";

test("only a plain, unsplit shell pane offers local history", () => {
  assert.deepEqual(parsePaneState("0 0 1 120 30\n"), {
    shell: true,
    historySize: 120,
    height: 30,
  });
  assert.equal(parsePaneState("1 0 1 120 30")?.shell, false); // vim, jcode
  assert.equal(parsePaneState("0 1 1 120 30")?.shell, false); // copy mode
  assert.equal(parsePaneState("0 0 2 120 30")?.shell, false); // split
  assert.equal(parsePaneState(null), null);
});
