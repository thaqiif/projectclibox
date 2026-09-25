import assert from "node:assert/strict";
import test from "node:test";
import { expandHomePath } from "./terminal-capabilities";

test("terminal capability roots resolve tmux home shorthand against HOME", () => {
  assert.equal(expandHomePath("~", "/home/cliweb"), "/home/cliweb");
  assert.equal(
    expandHomePath("~/workspace/project", "/home/cliweb"),
    "/home/cliweb/workspace/project"
  );
  assert.equal(
    expandHomePath("/workspaces/project", "/home/cliweb"),
    "/workspaces/project"
  );
});
