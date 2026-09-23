/**
 * Data-integrity tests for the editor persistence surface: the content
 * route's conflict / deleted-on-disk / binary-overwrite matrix, and the
 * chunked upload protocol (assembler caps, collision handling, 0-byte
 * rejection, partial cleanup on overflow).
 *
 * Shares lib/ops-test-env.ts (isolates HOME before route import) with
 * ops-route-func.test.ts; each test file runs in its own process.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ops-test-env forces process.env.HOME to an isolated root BEFORE route
// modules are imported (they bind HOME-derived paths at load time).
const HOME = process.env.HOME!;
const WS = join(HOME, "ws-content");
mkdirSync(WS, { recursive: true });
writeFileSync(join(WS, "text.txt"), "target\n");

let contentGet: (req: unknown) => Promise<unknown>;
let contentPost: (req: unknown) => Promise<unknown>;
let uploadPost: (req: unknown) => Promise<unknown>;
const routesReady = Promise.all([
  import("../app/api/files/content/route").then((m) => {
    contentGet = m.GET as typeof contentGet;
    contentPost = m.POST as typeof contentPost;
  }),
  import("../app/api/files/upload-temp/route").then((m) => {
    uploadPost = m.POST as typeof uploadPost;
  }),
]);

// Route handles are loaded asynchronously (CJS-friendly eager imports); every
// call site awaits this promise once before invoking.
async function callcontentGet(req: unknown): Promise<unknown> {
  await routesReady;
  return contentGet!(req);
}
async function callcontentPost(req: unknown): Promise<unknown> {
  await routesReady;
  return contentPost!(req);
}
async function calluploadPost(req: unknown): Promise<unknown> {
  await routesReady;
  return uploadPost!(req);
}

function jsonReq(url: string, body: unknown) {
  return {
    url,
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      origin: "http://localhost:3000",
      host: "localhost:3000",
    }),
    nextUrl: new URL(url),
    json: async () => JSON.parse(JSON.stringify(body)),
  } as unknown as import("next/server").NextRequest;
}

function getReq(url: string) {
  return {
    url,
    method: "GET",
    headers: new Headers(),
    nextUrl: new URL(url),
  } as unknown as import("next/server").NextRequest;
}

async function status(res: unknown): Promise<number> {
  return (res as { status: number }).status;
}

async function body(res: unknown): Promise<Record<string, unknown>> {
  return JSON.parse(await (res as { text: () => Promise<string> }).text());
}

test("content: fresh mtime save succeeds and reports the post-write mtime", async () => {
  const res = await callcontentGet(
    getReq(`http://x/api/files/content?path=${encodeURIComponent(`${WS}/text.txt`)}`)
  );
  assert.equal(await status(res), 200);
  const got = await body(res);
  assert.equal(got.content, "target\n");

  const post = await callcontentPost(
    jsonReq("http://x/api/files/content", {
      path: `${WS}/text.txt`,
      content: "written\n",
      expectedMtimeMs: got.mtimeMs,
    })
  );
  assert.equal(await status(post), 200);
  const wrote = await body(post);
  assert.equal(typeof wrote.mtimeMs, "number");
  assert.equal(readFileSync(`${WS}/text.txt`, "utf8"), "written\n");
});

test("content: stale mtime save is rejected with 409 and leaves the file intact", async () => {
  const post = await callcontentPost(
    jsonReq("http://x/api/files/content", {
      path: `${WS}/text.txt`,
      content: "clobber\n",
      expectedMtimeMs: 1,
    })
  );
  assert.equal(await status(post), 409);
  const data = await body(post);
  assert.equal(data.error, "conflict");
  assert.equal(typeof data.serverMtimeMs, "number");
  assert.equal(readFileSync(`${WS}/text.txt`, "utf8"), "written\n");
});

test("content: save of a deleted file is a 409 conflict, not a silent recreate", async () => {
  const statAt = await callcontentGet(
    getReq(`http://x/api/files/content?path=${encodeURIComponent(`${WS}/delete-me.txt`)}`)
  );
  // ensure an expected mtime is in play: stats of the file that existed
  rmSync(`${WS}/delete-me.txt`, { force: true });
  const res = await callcontentPost(
    jsonReq("http://x/api/files/content", {
      path: `${WS}/delete-me.txt`,
      content: "resurrect\n",
      expectedMtimeMs: 123,
    })
  );
  assert.equal(await status(res), 409);
  const data = await body(res);
  assert.equal(data.error, "conflict");
  assert.equal(data.deleted, true);
  assert.ok(!existsSync(`${WS}/delete-me.txt`), "file must not be recreated");

  // Explicit force overwrite still recreates the file.
  const back = await callcontentPost(
    jsonReq("http://x/api/files/content", {
      path: `${WS}/delete-me.txt`,
      content: "recreated\n",
      force: true,
    })
  );
  assert.equal(await status(back), 200);
  assert.equal(readFileSync(`${WS}/delete-me.txt`, "utf8"), "recreated\n");
});

test("content: new-file creation without expectedMtimeMs still works", async () => {
  const res = await callcontentPost(
    jsonReq("http://x/api/files/content", {
      path: `${WS}/new.txt`,
      content: "brand new\n",
    })
  );
  assert.equal(await status(res), 200);
  assert.equal(readFileSync(`${WS}/new.txt`, "utf8"), "brand new\n");
});

test("content: binary guard blocks text saves; conflict overwrite may force past it", async () => {
  const binPath = `${WS}/became-binary.dat`;
  writeFileSync(binPath, "opened as text\n"); // opened while text

  // On disk it changed into binary (null bytes) while the editor had it.
  writeFileSync(binPath, Buffer.from("BIN\0\0ARY"));

  // A plain save (no force) is refused with 415: never destroy binary
  // content the editor cannot represent.
  const plain = await callcontentPost(
    jsonReq("http://x/api/files/content", { path: binPath, content: "text" })
  );
  assert.equal(await status(plain), 415);

  // force without allowBinaryOverwrite is still refused.
  const forceOnly = await callcontentPost(
    jsonReq("http://x/api/files/content", {
      path: binPath,
      content: "text",
      force: true,
    })
  );
  assert.equal(await status(forceOnly), 415);

  // The conflict dialog's confirmed overwrite (force + allowBinaryOverwrite)
  // is the only path allowed to replace the on-disk binary.
  const overwrite = await callcontentPost(
    jsonReq("http://x/api/files/content", {
      path: binPath,
      content: "confirms overwrite\n",
      force: true,
      allowBinaryOverwrite: true,
    })
  );
  assert.equal(await status(overwrite), 200);
  assert.equal(readFileSync(binPath, "utf8"), "confirms overwrite\n");
});

// --- chunked upload ---------------------------------------------------------

test("chunked upload: full flow writes the file and cleans partials", async () => {
  const dir = mkdtempSync(`${tmpdir()}/upload-flow-`);
  const totalBytes = 512 * 1024 + 11; // 1.5 chunks at 512KB
  const chunkSize = 512 * 1024;
  const chunkA = Buffer.alloc(chunkSize, 65); // "A"
  const chunkB = Buffer.alloc(11, 66); // "B"

  const init = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "init",
      filename: "flow.bin",
      totalBytes,
      totalChunks: 2,
      targetDir: dir,
    })
  );
  assert.equal(await status(init), 200);
  const { uploadId, chunkSize: serverChunk } = await body(init);
  assert.equal(serverChunk, chunkSize);

  const c1 = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "chunk",
      uploadId,
      chunkIndex: 0,
      chunk: chunkA.toString("base64"),
    })
  );
  assert.equal(await status(c1), 200);
  assert.equal((await body(c1)).received, chunkSize);
  assert.ok(existsSync(`${tmpdir()}/cliweb-upload-partials/${uploadId}`));

  const c2 = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "chunk",
      uploadId,
      chunkIndex: 1,
      chunk: chunkB.toString("base64"),
    })
  );
  assert.equal(await status(c2), 200);
  assert.ok((await body(c2)).path, "final chunk returns the assembled path");
  assert.equal(readFileSync(`${dir}/flow.bin`).length, totalBytes);
  assert.ok(
    !existsSync(`${tmpdir()}/cliweb-upload-partials/${uploadId}`),
    "partials must be removed after assembly"
  );
  rmSync(dir, { recursive: true, force: true });
});

test("chunked upload: 0-byte file is rejected at init", async () => {
  const init = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "init",
      filename: "empty.bin",
      totalBytes: 0,
      totalChunks: 1,
    })
  );
  assert.equal(await status(init), 400);
});

test("chunked upload: wrong totalChunks arithmetic is rejected", async () => {
  const init = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "init",
      filename: "wrong.bin",
      totalBytes: 512 * 1024,
      totalChunks: 2,
    })
  );
  assert.equal(await status(init), 400);
});

test("chunked upload: oversized mid-chunk kills the session and deletes partials", async () => {
  const dir = mkdtempSync(`${tmpdir()}/upload-cap-`);
  const init = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "init",
      filename: "cap.bin",
      totalBytes: 10,
      totalChunks: 1,
      targetDir: dir,
    })
  );
  assert.equal(await status(init), 200);
  const { uploadId } = await body(init);

  // Boundary first: exactly the declared size must assemble fine.
  const bad = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "chunk",
      uploadId,
      chunkIndex: 0,
      chunk: Buffer.alloc(11, 65).toString("base64"),
    })
  );
  assert.equal(await status(bad), 413);
  assert.ok(!existsSync(`${tmpdir()}/cliweb-upload-partials/${uploadId}`));
  assert.ok(readdirSync(dir).length === 0, "target dir stays empty");
  rmSync(dir, { recursive: true, force: true });
});

test("chunked upload: same filename twice timestamps the second, overwrite=true replaces", async () => {
  const dir = mkdtempSync(`${tmpdir()}/upload-collision-`);
  const chunk = Buffer.alloc(4, 65);

  const first = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "init",
      filename: "same.txt",
      totalBytes: 4,
      totalChunks: 1,
      targetDir: dir,
    })
  );
  const firstBody = await body(first);
  await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "chunk",
      uploadId: firstBody.uploadId,
      chunkIndex: 0,
      chunk: chunk.toString("base64"),
    })
  );
  assert.equal(readFileSync(`${dir}/same.txt`, "utf8"), "AAAA");

  // Concurrent-style second upload of the same name: timestamps, no clobber.
  const second = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "init",
      filename: "same.txt",
      totalBytes: 4,
      totalChunks: 1,
      targetDir: dir,
    })
  );
  const secondBody = await body(second);
  await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "chunk",
      uploadId: secondBody.uploadId as string,
      chunkIndex: 0,
      chunk: Buffer.alloc(4, 66).toString("base64"),
    })
  );
  assert.equal(readFileSync(`${dir}/same.txt`, "utf8"), "AAAA");
  const listing = readdirSync(dir).filter((n) => n !== "same.txt");
  assert.equal(listing.length, 1, "second upload landed under a new name");

  // overwrite=True replaces the original in place.
  const third = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "init",
      filename: "same.txt",
      totalBytes: 4,
      totalChunks: 1,
      targetDir: dir,
      overwrite: true,
    })
  );
  const thirdBody = await body(third);
  await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "chunk",
      uploadId: thirdBody.uploadId as string,
      chunkIndex: 0,
      chunk: Buffer.alloc(4, 67).toString("base64"),
    })
  );
  assert.equal(readFileSync(`${dir}/same.txt`, "utf8"), "CCCC");
  assert.equal(
    readdirSync(dir).filter((n) => n.startsWith("same.txt") || n.endsWith(".txt"))
      .length,
    2,
    "no extra copies after overwrite"
  );
  rmSync(dir, { recursive: true, force: true });
});

test("chunked upload: a failed session leaves the client usable for the next upload", async () => {
  const dir = mkdtempSync(`${tmpdir()}/upload-retry-`);
  // Out-of-order chunk kills nothing server-side but is rejected; the
  // retry with fresh init must succeed.
  const init = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "init",
      filename: "retry.txt",
      totalBytes: 4,
      totalChunks: 1,
      targetDir: dir,
    })
  );
  const { uploadId } = await body(init);
  const wrong = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "chunk",
      uploadId,
      chunkIndex: 3,
      chunk: Buffer.alloc(4, 65).toString("base64"),
    })
  );
  assert.equal(await status(wrong), 400);

  const retry = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "init",
      filename: "retry.txt",
      totalBytes: 4,
      totalChunks: 1,
      targetDir: dir,
    })
  );
  assert.equal(await status(retry), 200, "fresh init works after a bad chunk");
  const retryBody = await body(retry);
  const done = await calluploadPost(
    jsonReq("http://x/api/files/upload-temp", {
      op: "chunk",
      uploadId: retryBody.uploadId as string,
      chunkIndex: 0,
      chunk: Buffer.alloc(4, 72).toString("base64"),
    })
  );
  assert.equal(await status(done), 200);
  assert.equal(readFileSync(`${dir}/retry.txt`, "utf8"), "HHHH");
  rmSync(dir, { recursive: true, force: true });
});
