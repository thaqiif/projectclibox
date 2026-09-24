import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readFileContent, writeFileContent } from "./files";

// --- Test fixture tree -------------------------------------------------------

const tmpRoot = mkdtempSync(`${tmpdir()}/files-test-`);
mkdirSync(join(tmpRoot, "data"), { recursive: true });

const TEXT_PATH = join(tmpRoot, "data", "notes.txt");
const BINARY_PATH = join(tmpRoot, "data", "video.mp4");
const NULL_AT_TAIL_PATH = join(tmpRoot, "data", "tail-null.txt");
writeFileSync(TEXT_PATH, "hello world\nplain text\n");
// Video-like: binary right in the first bytes, larger than any sniff window.
writeFileSync(BINARY_PATH, Buffer.concat([Buffer.alloc(64 * 1024 + 7, 0), Buffer.alloc(9, 1)]));
// Text head, single null byte at the very end: still binary, never savable.
writeFileSync(NULL_AT_TAIL_PATH, Buffer.concat([Buffer.from("clean text\n"), Buffer.alloc(1, 0)]));

test.after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// --- readFileContent ---------------------------------------------------------

test("readFileContent returns text for regular text files", () => {
  const result = readFileContent(TEXT_PATH);
  assert.equal(result.isBinary, false);
  assert.equal(result.truncated, false);
  assert.equal(result.content, "hello world\nplain text\n");
});

test("readFileContent marks binary files isBinary:true and never savable", () => {
  const result = readFileContent(BINARY_PATH);
  assert.equal(result.isBinary, true);
  assert.equal(result.truncated, false);
  // The content string is a stub note, NOT the file bytes.
  assert.match(result.content, /^Binary file/);
});

test("readFileContent refuses oversized files with isBinary:true (the lie that caused data loss)", () => {
  // 34MB video destroyed by a save of the placeholder string happened
  // exactly because oversized reads reported isBinary:false.
  const result = readFileContent(BINARY_PATH, { maxSize: 1024 });
  assert.equal(result.isBinary, true);
  assert.equal(result.truncated, true);
  assert.equal(result.size, 65543 + 9);
  assert.match(result.content, /^File too large/);
});

test("readFileContent flags a null byte at the tail as binary too", () => {
  const result = readFileContent(NULL_AT_TAIL_PATH);
  assert.equal(result.isBinary, true);
  assert.equal(result.truncated, false);
});

test("readFileContent default limit is 2MB, not 1MB", () => {
  // Just over the old 1MB default but under the new one: must come back as
  // savable text, not truncated.
  const path = join(tmpRoot, "data", "big-text.txt");
  writeFileSync(path, Buffer.alloc(1.5 * 1024 * 1024, "a"));
  const result = readFileContent(path);
  assert.equal(result.isBinary, false);
  assert.equal(result.truncated, false);
  // Just over the new default: truncated, flagged, unsavable.
  writeFileSync(path, Buffer.alloc(3 * 1024 * 1024, "a"));
  const over = readFileContent(path);
  assert.equal(over.isBinary, true);
  assert.equal(over.truncated, true);
});

// --- writeFileContent binary-overwrite guard ---------------------------------

test("writeFileContent refuses to overwrite a binary file with text", () => {
  const before = readFileContent(BINARY_PATH);
  assert.equal(before.isBinary, true);
  assert.throws(
    () => writeFileContent(BINARY_PATH, "placeholder text from an editor"),
    /refusing to overwrite binary file with text/
  );
  // The file must be untouched after the refused write.
  const after = readFileContent(BINARY_PATH);
  assert.equal(after.content, before.content);
  assert.equal(after.isBinary, true);
});

test("writeFileContent guard covers a null byte at the tail as well", () => {
  assert.throws(
    () => writeFileContent(NULL_AT_TAIL_PATH, "replacement text"),
    /refusing to overwrite binary file with text/
  );
});

test("writeFileContent allowBinaryOverwrite is an explicit opt-in", () => {
  writeFileSync(BINARY_PATH, Buffer.alloc(16, 0));
  const result = writeFileContent(BINARY_PATH, "explicit confirmed overwrite", {
    allowBinaryOverwrite: true,
  });
  assert.equal(result.success, true);
  assert.equal(readFileContent(BINARY_PATH).content, "explicit confirmed overwrite");
});

test("writeFileContent still writes plain text files normally", () => {
  const result = writeFileContent(TEXT_PATH, "updated text\n");
  assert.equal(result.success, true);
  assert.equal(readFileContent(TEXT_PATH).content, "updated text\n");
});

test("writeFileContent creates a new file without any binary sniff interference", () => {
  const newPath = join(tmpRoot, "data", "created-by-save.txt");
  const result = writeFileContent(newPath, "brand new file");
  assert.equal(result.success, true);
  assert.equal(readFileContent(newPath).content, "brand new file");
});
