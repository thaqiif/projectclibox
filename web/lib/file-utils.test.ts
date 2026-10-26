import assert from "node:assert/strict";
import test from "node:test";
import { matchesFilter, type FileNode } from "./file-utils";

function node(name: string, type: "file" | "directory" = "file"): FileNode {
  return { name, path: `/tmp/${name}`, type };
}

test("matchesFilter matches basename substring case-insensitively", () => {
  assert.equal(matchesFilter(node("README.md"), "readme"), true);
  assert.equal(matchesFilter(node("app.config.ts"), "CONFIG"), true);
  assert.equal(matchesFilter(node("notes.txt"), "ote"), true);
  assert.equal(matchesFilter(node("main.ts"), "mainx"), false);
});

test("matchesFilter matches anywhere, not only the prefix", () => {
  assert.equal(matchesFilter(node("src-index-helper.ts"), "helper"), true);
  assert.equal(matchesFilter(node("a/b/fixture.json"), "fixture"), true);
});

test("matchesFilter treats empty or whitespace term as match-all", () => {
  assert.equal(matchesFilter(node("anything.xyz"), ""), true);
  assert.equal(matchesFilter(node("anything.xyz"), "   "), true);
});

test("matchesFilter does not match across path, only the basename", () => {
  const nested: FileNode = { name: "index.ts", path: "/proj/src/index.ts", type: "file" };
  assert.equal(matchesFilter(nested, "proj"), false);
  assert.equal(matchesFilter(nested, "index"), true);
});

test("matchesFilter works for directory nodes too", () => {
  assert.equal(matchesFilter(node("components", "directory"), "pone"), true);
  assert.equal(matchesFilter(node("components", "directory"), "lib"), false);
});
