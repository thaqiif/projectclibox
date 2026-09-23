import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PASTE_AS_FILE_THRESHOLD,
  pasteFileName,
  uploadTargetDir,
} from "./file-upload";

test("uploadTargetDir joins tmp under the working directory", () => {
  assert.equal(uploadTargetDir("/home/u/project"), "/home/u/project/tmp");
  assert.equal(uploadTargetDir("/home/u/project/"), "/home/u/project/tmp");
  assert.equal(uploadTargetDir("~"), "~/tmp");
});

test("uploadTargetDir without a cwd falls back to undefined (/tmp upstream)", () => {
  assert.equal(uploadTargetDir(undefined), undefined);
  assert.equal(uploadTargetDir(null), undefined);
  assert.equal(uploadTargetDir(""), undefined);
});

test("paste file names collide-safe timestamped .txt", () => {
  const a = pasteFileName(new Date(2026, 8, 24, 15, 30, 0, 5));
  const b = pasteFileName(new Date(2026, 8, 24, 15, 30, 0, 6));
  assert.match(a, /^paste-2026-09-24T153000-005\.txt$/);
  assert.notEqual(a, b, "millisecond suffix keeps rapid pastes unique");
});

test("long-text paste threshold is 2000 chars", () => {
  assert.equal(PASTE_AS_FILE_THRESHOLD, 2000);
});
