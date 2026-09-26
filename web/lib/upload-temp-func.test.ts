/**
 * Functional tests for the chunked upload protocol in
 * /api/files/upload-temp/route.ts, hitting the route handler directly.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { POST as uploadPost } from "../app/api/files/upload-temp/route";

// HOME must be isolated before this module is imported: the route binds
// paths at load time like the other file routes.
import { UPLOAD_TMP_ROOT } from "./upload-temp-test-env";
const HOME = process.env.HOME!;
assert.equal(HOME, UPLOAD_TMP_ROOT);

const WS = join(HOME, "uploads");
mkdirSync(WS, { recursive: true });

test.after(() => {
  rmSync(UPLOAD_TMP_ROOT, { recursive: true, force: true });
});

function jsonReq(body: unknown) {
  return {
    url: "http://x/api/files/upload-temp",
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      origin: "http://x",
      host: "x",
    }),
    nextUrl: new URL("http://x/api/files/upload-temp"),
    json: async () => JSON.parse(JSON.stringify(body)),
  } as unknown as import("next/server").NextRequest;
}

async function status(res: unknown) {
  return (res as { status: number }).status;
}
async function data(res: unknown) {
  return JSON.parse(await (res as { text: () => Promise<string> }).text());
}

const CHUNK = 512 * 1024; // UPLOAD_CHUNK_BYTES

async function happyPathInit(totalBytes: number, chunks: number, filename = "assembled.bin") {
  const init = await uploadPost(
    jsonReq({
      op: "init",
      filename,
      totalBytes,
      totalChunks: chunks,
      targetDir: WS,
    })
  );
  assert.equal(await status(init), 200);
  const body = await data(init);
  return body as { uploadId: string; chunkSize: number };
}

test("chunked upload: happy path assembles in exact index order", async () => {
  const total = CHUNK * 2 + 11;
  const bytes = Buffer.alloc(total, 0xab);
  bytes[0] = 1;
  bytes[CHUNK] = 2;
  bytes[total - 1] = 9;
  const up = await happyPathInit(total, 3);

  for (let i = 0; i < 3; i++) {
    const slice = bytes.subarray(
      i * CHUNK,
      Math.min((i + 1) * CHUNK, total)
    );
    const res = await uploadPost(
      jsonReq({
        op: "chunk",
        uploadId: up.uploadId,
        chunkIndex: i,
        chunk: slice.toString("base64"),
      })
    );
    if (i < 2) {
      assert.equal(await status(res), 200);
    } else {
      assert.equal(await status(res), 200);
      const body = await data(res);
      assert.equal(body.path, join(WS, "assembled.bin"));
    }
  }
  const onDisk = readFileSync(join(WS, "assembled.bin"));
  assert.deepEqual([...onDisk.subarray(0, 1)], [1]);
  assert.deepEqual([...onDisk.subarray(CHUNK, CHUNK + 1)], [2]);
  assert.deepEqual([...onDisk.subarray(total - 1)], [9]);
  assert.equal(onDisk.length, total);
});

async function oneChunkUpload(targetDir: string, filename: string) {
  const init = await uploadPost(
    jsonReq({
      op: "init",
      filename,
      totalBytes: 1,
      totalChunks: 1,
      targetDir,
    })
  );
  assert.equal(await status(init), 200);
  const { uploadId } = await data(init);
  return uploadPost(
    jsonReq({
      op: "chunk",
      uploadId,
      chunkIndex: 0,
      chunk: Buffer.from("x").toString("base64"),
    })
  );
}

test("terminal upload returns a clean conflict when cwd was deleted", async () => {
  const deletedCwd = join(WS, "deleted-cwd");
  const res = await oneChunkUpload(join(deletedCwd, "tmp"), "drop.txt");
  assert.equal(await status(res), 409);
  assert.match((await data(res)).error as string, /destination is unavailable/i);
});

test("terminal upload creates the missing <cwd>/tmp leaf and nothing above it", async () => {
  const cwd = join(WS, "fresh-cwd");
  mkdirSync(cwd, { recursive: true });
  const tmp = join(cwd, "tmp");
  assert.equal(existsSync(tmp), false);

  const res = await oneChunkUpload(tmp, "paste-drop.txt");
  assert.equal(await status(res), 200);
  const body = await data(res);
  assert.equal(body.path, join(tmp, "paste-drop.txt"));
  assert.equal(readFileSync(join(tmp, "paste-drop.txt"), "utf8"), "x");
  assert.equal(existsSync(cwd), true, "the cwd itself is never recreated");
});

test("concurrent uploads into a fresh <cwd>/tmp do not trip on the mkdir race", async () => {
  const cwd = join(WS, "race-cwd");
  mkdirSync(cwd, { recursive: true });
  const tmp = join(cwd, "tmp");

  const results = await Promise.all([
    oneChunkUpload(tmp, "race-a.txt"),
    oneChunkUpload(tmp, "race-b.txt"),
  ]);
  for (const res of results) {
    assert.equal(await status(res), 200);
  }
  assert.equal(readFileSync(join(tmp, "race-a.txt"), "utf8"), "x");
  assert.equal(readFileSync(join(tmp, "race-b.txt"), "utf8"), "x");
});

test("file-manager drops never recreate a missing destination", async () => {
  const missing = join(WS, "gone-folder");
  const init = await uploadPost(
    jsonReq({
      op: "init",
      filename: "drop.txt",
      totalBytes: 1,
      totalChunks: 1,
      targetDir: missing,
      createTargetDir: false,
    })
  );
  assert.equal(await status(init), 200);
  const { uploadId } = await data(init);
  const res = await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId,
      chunkIndex: 0,
      chunk: Buffer.from("x").toString("base64"),
    })
  );
  assert.equal(await status(res), 409);
  assert.match((await data(res)).error as string, /no longer exists/i);
  assert.equal(existsSync(missing), false, "the destination stays deleted");
});

test("file-manager drops still land in an existing destination", async () => {
  const existing = join(WS, "browsed-folder");
  mkdirSync(existing, { recursive: true });
  const init = await uploadPost(
    jsonReq({
      op: "init",
      filename: "drop.txt",
      totalBytes: 1,
      totalChunks: 1,
      targetDir: existing,
      createTargetDir: false,
    })
  );
  assert.equal(await status(init), 200);
  const { uploadId } = await data(init);
  const res = await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId,
      chunkIndex: 0,
      chunk: Buffer.from("x").toString("base64"),
    })
  );
  assert.equal(await status(res), 200);
  assert.equal(readFileSync(join(existing, "drop.txt"), "utf8"), "x");
});

test("one-shot uploads honor createTargetDir=false as well", async () => {
  const missing = join(WS, "gone-one-shot");
  const res = await uploadPost(
    jsonReq({
      filename: "shot.png",
      base64: Buffer.from("x").toString("base64"),
      mimeType: "image/png",
      targetDir: missing,
      createTargetDir: false,
    })
  );
  assert.equal(await status(res), 409);
  assert.match((await data(res)).error as string, /no longer exists/i);
  assert.equal(existsSync(missing), false);
});

test("terminal upload returns a clean conflict when cwd is a file", async () => {
  const fileCwd = join(WS, "file-cwd");
  writeFileSync(fileCwd, "not a directory");
  const res = await oneChunkUpload(join(fileCwd, "tmp"), "drop.txt");
  assert.equal(await status(res), 409);
  assert.match((await data(res)).error as string, /not a directory/i);
});

test("terminal upload returns a clean conflict when cwd/tmp is a file", async () => {
  const cwd = join(WS, "tmp-is-file");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "tmp"), "not a directory");
  const res = await oneChunkUpload(join(cwd, "tmp"), "drop.txt");
  assert.equal(await status(res), 409);
  assert.match((await data(res)).error as string, /not a directory/i);
});

test("chunked upload: out-of-order chunk is rejected, session unaffected", async () => {
  const up = await happyPathInit(CHUNK + 5, 2, "ooo.bin");
  const skipTo = await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 1,
      chunk: Buffer.alloc(5, 1).toString("base64"),
    })
  );
  assert.equal(await status(skipTo), 400);
  // Correct chunk 0 afterwards still works.
  const ok = await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 0,
      chunk: Buffer.alloc(CHUNK, 2).toString("base64"),
    })
  );
  assert.equal(await status(ok), 200);
  await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 1,
      chunk: Buffer.alloc(5, 3).toString("base64"),
    })
  );
  assert.equal(readFileSync(join(WS, "ooo.bin")).length, CHUNK + 5);
});

test("chunked upload: unknown/duplicate uploadId paths fail cleanly", async () => {
  const bogus = await uploadPost(
    jsonReq({ op: "chunk", uploadId: "bogus-999", chunkIndex: 0, chunk: "AAAA" })
  );
  assert.equal(await status(bogus), 404);

  // Complete a real upload, then reuse the completed (and hence deleted) id.
  const up = await happyPathInit(1024, 1, "dup.bin");
  const done = await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 0,
      chunk: Buffer.alloc(1024, 3).toString("base64"),
    })
  );
  assert.equal(await status(done), 200);
  const again = await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 0,
      chunk: Buffer.alloc(1024, 3).toString("base64"),
    })
  );
  assert.equal(await status(again), 404);
});

test("chunked upload: empty and non-decoding chunks rejected", async () => {
  const up = await happyPathInit(CHUNK + 1, 2, "decoding.bin");
  const empty = await uploadPost(
    jsonReq({ op: "chunk", uploadId: up.uploadId, chunkIndex: 0, chunk: "" })
  );
  assert.equal(await status(empty), 400);

  const badB64 = await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 0,
      chunk: "!!!not-base64!!!",
    })
  );
  const s = await status(badB64);
  assert.ok([400, 500].includes(s));
  // cleanup: finish so the session map does not leak into other tests
  await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 0,
      chunk: Buffer.alloc(CHUNK, 4).toString("base64"),
    })
  );
  await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 1,
      chunk: Buffer.alloc(1, 4).toString("base64"),
    })
  );
});

test("chunked upload: short mid-file chunk rejected before assembly", async () => {
  const up = await happyPathInit(CHUNK + 5, 2, "short.bin");
  const short = await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 0,
      chunk: Buffer.alloc(10, 5).toString("base64"),
    })
  );
  const s = await status(short);
  assert.ok(s >= 400);
  const body = await data(short);
  assert.match(body.error as string, /must be exactly/);
  // finish so the total receivedBytes check is not poisoned
  await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 0,
      chunk: Buffer.alloc(CHUNK, 6).toString("base64"),
    })
  );
  await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 1,
      chunk: Buffer.alloc(5, 6).toString("base64"),
    })
  );
});

test("chunked upload: lying init (bad totalChunks arithmetic) rejected", async () => {
  const bad = await uploadPost(
    jsonReq({
      op: "init",
      filename: "x.bin",
      totalBytes: CHUNK + 1,
      totalChunks: 1,
      targetDir: WS,
    })
  );
  assert.equal(await status(bad), 400);

  const tooBig = await uploadPost(
    jsonReq({
      op: "init",
      filename: "x.bin",
      totalBytes: 201 * 1024 * 1024,
      totalChunks: 2,
      targetDir: WS,
    })
  );
  assert.equal(await status(tooBig), 413);
});

test("chunked upload: payload above 200MB is cut off mid-stream (413)", async () => {
  // init with a valid plan but send oversized final content by lying in the
  // totalBytes is impossible (arithmetic is checked). Instead: send chunks
  // whose decoded sizes overflow the eventual assembled-size check. A last
  // chunk larger than declared fails the assembled-size comparison.
  const up = await happyPathInit(CHUNK + 1, 2, "fat.bin");
  await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 0,
      chunk: Buffer.alloc(CHUNK, 7).toString("base64"),
    })
  );
  const fat = await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 1,
      chunk: Buffer.alloc(CHUNK + 999, 7).toString("base64"),
    })
  );
  assert.equal(await status(fat), 413);
  assert.ok(!(await data(fat)).path);
});

test("chunked upload: without targetDir the screenshot temp dir is used", async () => {
  const init = await uploadPost(
    jsonReq({
      op: "init",
      filename: "shot.png",
      totalBytes: 8,
      totalChunks: 1,
      mimeType: "image/png",
    })
  );
  const up = await data(init);
  const done = await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId: up.uploadId,
      chunkIndex: 0,
      chunk: Buffer.from("12345678").toString("base64"),
    })
  );
  const body = await data(done);
  assert.match(body.path as string, /clibox-screenshots/);
  assert.equal(
    readFileSync(body.path as string).toString(),
    "12345678"
  );
});

test("paste upload without a cwd keeps its .txt name instead of appending the mime subtype", async () => {
  const text = "long paste body";
  const bytes = Buffer.from(text, "utf8");
  const init = await uploadPost(
    jsonReq({
      op: "init",
      filename: "paste-2026-09-24T153000-005.txt",
      totalBytes: bytes.length,
      totalChunks: 1,
      mimeType: "text/plain",
    })
  );
  assert.equal(await status(init), 200);
  const { uploadId } = await data(init);
  const done = await uploadPost(
    jsonReq({
      op: "chunk",
      uploadId,
      chunkIndex: 0,
      chunk: bytes.toString("base64"),
    })
  );
  assert.equal(await status(done), 200);
  const path = (await data(done)).path as string;
  assert.match(path, /paste-2026-09-24T153000-005\.txt$/);
  assert.doesNotMatch(path, /\.plain$/);
  assert.equal(readFileSync(path, "utf8"), text);
});
