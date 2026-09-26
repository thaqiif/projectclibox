import assert from "node:assert/strict";
import test from "node:test";
import { expandHomePath } from "./terminal-capabilities";

test("terminal capability roots resolve tmux home shorthand against HOME", () => {
  assert.equal(expandHomePath("~", "/home/clibox"), "/home/clibox");
  assert.equal(
    expandHomePath("~/workspace/project", "/home/clibox"),
    "/home/clibox/workspace/project"
  );
  assert.equal(
    expandHomePath("/workspaces/project", "/home/clibox"),
    "/workspaces/project"
  );
});
