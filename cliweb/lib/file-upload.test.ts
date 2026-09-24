import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PASTE_AS_FILE_THRESHOLD,
  PASTE_LONG_AS_FILE_PREF,
  pasteFileName,
  pasteLongAsFilePref,
  setPasteLongAsFilePref,
  shouldUploadPaste,
  uploadPasteWithInlineFallback,
  uploadTargetDir,
} from "./file-upload";

test("uploadTargetDir joins tmp under the working directory", () => {
  assert.equal(uploadTargetDir("/home/u/project"), "/home/u/project/tmp");
  assert.equal(uploadTargetDir("/home/u/project/"), "/home/u/project/tmp");
  assert.equal(uploadTargetDir("~"), "~/tmp");
  assert.equal(uploadTargetDir("/"), "/tmp");
  assert.equal(uploadTargetDir("///"), "/tmp");
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
  assert.equal(shouldUploadPaste("x".repeat(1999)), false);
  assert.equal(shouldUploadPaste("x".repeat(2000)), false);
  assert.equal(shouldUploadPaste("x".repeat(2001)), true);
});

test("long-paste preference defaults true and persists checkbox changes", () => {
  const values = new Map<string, string>();
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  });
  try {
    assert.equal(pasteLongAsFilePref(), true);
    setPasteLongAsFilePref(false);
    assert.equal(values.get(PASTE_LONG_AS_FILE_PREF), "false");
    assert.equal(pasteLongAsFilePref(), false);
    setPasteLongAsFilePref(true);
    assert.equal(pasteLongAsFilePref(), true);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});

test("failed paste-as-file restores the consumed clipboard text inline", async () => {
  const pasted: string[] = [];
  const noPath = await uploadPasteWithInlineFallback(
    "clipboard body",
    async () => null,
    (text) => pasted.push(text)
  );
  assert.deepEqual(noPath, { path: null });
  assert.deepEqual(pasted, ["clipboard body"]);

  const failure = new Error("destination unavailable");
  const rejected = await uploadPasteWithInlineFallback(
    "second body",
    async () => {
      throw failure;
    },
    (text) => pasted.push(text)
  );
  assert.equal(rejected.path, null);
  assert.equal(rejected.error, failure);
  assert.deepEqual(pasted, ["clipboard body", "second body"]);
});

test("successful paste-as-file inserts only its path", async () => {
  const pasted: string[] = [];
  const result = await uploadPasteWithInlineFallback(
    "clipboard body",
    async () => "/workspace/tmp/paste.txt",
    (text) => pasted.push(text)
  );
  assert.deepEqual(result, { path: "/workspace/tmp/paste.txt" });
  assert.deepEqual(pasted, []);
});
