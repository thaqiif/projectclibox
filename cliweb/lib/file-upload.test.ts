import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PASTE_AS_FILE_THRESHOLD,
  PASTE_LONG_AS_FILE_PREF,
  PASTE_EDITOR_ATTR,
  isPasteEditorTarget,
  pasteActionFor,
  pasteFileName,
  pasteLongAsFilePref,
  onUploadComplete,
  publishUploadComplete,
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

test("paste routing converts only long clipboard text, never typing", () => {
  const desktop = { isMobile: false, preferFile: true };
  const short = "x".repeat(PASTE_AS_FILE_THRESHOLD);
  const long = "x".repeat(PASTE_AS_FILE_THRESHOLD + 1);

  // Typed input cannot reach this function at all (no paste event), and a
  // paste of any length below the threshold stays inline.
  assert.equal(
    pasteActionFor({ hasFiles: false, text: short, ...desktop }),
    "ignore"
  );
  assert.equal(
    pasteActionFor({ hasFiles: false, text: long, ...desktop }),
    "upload-file"
  );
  // Preference off restores the old inline behavior on desktop.
  assert.equal(
    pasteActionFor({
      hasFiles: false,
      text: long,
      isMobile: false,
      preferFile: false,
    }),
    "ignore"
  );
  // Mobile always asks before converting, whatever the stored preference.
  assert.equal(
    pasteActionFor({
      hasFiles: false,
      text: long,
      isMobile: true,
      preferFile: true,
    }),
    "dialog"
  );
  assert.equal(
    pasteActionFor({
      hasFiles: false,
      text: short,
      isMobile: true,
      preferFile: true,
    }),
    "ignore"
  );
  // Real clipboard files keep uploading regardless of text length.
  assert.equal(
    pasteActionFor({
      hasFiles: true,
      text: "",
      isMobile: true,
      preferFile: false,
    }),
    "files"
  );
});

test("upload completion notifies subscribers and isolates listener failures", () => {
  const seen: string[] = [];
  const unsubscribe = onUploadComplete(() => {
    throw new Error("subscriber blew up");
  });
  const unsubscribeHealthy = onUploadComplete((path) => seen.push(path));

  try {
    // A throwing subscriber must not stop the healthy one, and the caller
    // still sees the upload as successful.
    publishUploadComplete("/home/u/project/tmp/paste-1.txt");
    assert.deepEqual(seen, ["/home/u/project/tmp/paste-1.txt"]);
  } finally {
    unsubscribe();
    unsubscribeHealthy();
  }

  publishUploadComplete("/home/u/project/tmp/paste-2.txt");
  assert.deepEqual(
    seen,
    ["/home/u/project/tmp/paste-1.txt"],
    "unsubscribed listeners stop receiving events"
  );
});

test("the terminal ignores pastes aimed at a paste dialog's own textarea", () => {
  const editor = {
    closest: (selector: string) =>
      selector === `[${PASTE_EDITOR_ATTR}]` ? editor : null,
  };
  // xterm's hidden textarea and ordinary page elements stay interceptable.
  const xtermTextarea = { closest: () => null };
  assert.equal(isPasteEditorTarget(editor), true);
  assert.equal(isPasteEditorTarget(xtermTextarea), false);
  // Non-element paste targets (null target, plain objects) must not throw.
  assert.equal(isPasteEditorTarget(null), false);
  assert.equal(isPasteEditorTarget(undefined), false);
  assert.equal(isPasteEditorTarget({}), false);
  assert.equal(isPasteEditorTarget("div"), false);
});
