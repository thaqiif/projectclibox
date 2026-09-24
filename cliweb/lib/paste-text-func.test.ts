import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { OPS_TMP_ROOT } from "./ops-test-env";
import { POST as uploadPost } from "../app/api/files/upload-temp/route";
import { GET as contentGet } from "../app/api/files/content/route";

const ROOT = join(OPS_TMP_ROOT, "paste-text-functional");

test.after(() => rmSync(ROOT, { recursive: true, force: true }));

function request(body: unknown) {
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

function getRequest(url: string) {
  return {
    url,
    method: "GET",
    headers: new Headers(),
    nextUrl: new URL(url),
  } as unknown as import("next/server").NextRequest;
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

test("paste text is exact UTF-8 without BOM/newline and opens in the editor", async () => {
  const targetDir = join(ROOT, "tmp");
  mkdirSync(targetDir, { recursive: true });
  const text = "正值 café 🚀";
  const bytes = Buffer.from(text, "utf8");

  const init = await uploadPost(
    request({
      op: "init",
      filename: "paste-utf8.txt",
      totalBytes: bytes.length,
      totalChunks: 1,
      mimeType: "text/plain",
      targetDir,
    })
  );
  assert.equal(init.status, 200);
  const { uploadId } = await body(init);
  const done = await uploadPost(
    request({
      op: "chunk",
      uploadId,
      chunkIndex: 0,
      chunk: bytes.toString("base64"),
    })
  );
  assert.equal(done.status, 200);
  const path = (await body(done)).path as string;
  assert.equal(path, join(targetDir, "paste-utf8.txt"));

  const stored = readFileSync(path);
  assert.deepEqual(stored, bytes);
  assert.notDeepEqual([...stored.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.notEqual(stored.at(-1), 0x0a);

  const opened = await contentGet(
    getRequest(`http://x/api/files/content?path=${encodeURIComponent(path)}`)
  );
  assert.equal(opened.status, 200);
  const editorData = await body(opened);
  assert.equal(editorData.content, text);
  assert.equal(editorData.isBinary, false);
});
