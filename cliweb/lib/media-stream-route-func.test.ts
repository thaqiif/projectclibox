import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as downloadGet } from "../app/api/files/download/route";
import { GET as streamGet, HEAD as streamHead } from "../app/api/files/stream/route";
import { MIME_TYPES, mediaKindFor, mimeTypeFor } from "./media-mime";
import { clampMediaZoom, offsetAfterZoom } from "./media-viewer";
import { saveRefusalFor } from "./file-editor-save";

const ROOT = mkdtempSync(join(tmpdir(), "cliweb-media-stream-"));
const FILE = join(ROOT, "sample.mp4");
const EMPTY = join(ROOT, "empty.mp4");
writeFileSync(FILE, "0123456789");
writeFileSync(EMPTY, "");

test.after(() => rmSync(ROOT, { recursive: true, force: true }));

function request(
  route: "stream" | "download",
  filePath: string,
  options: { method?: "GET" | "HEAD"; range?: string } = {}
) {
  const method = options.method ?? "GET";
  const url = `http://localhost/api/files/${route}?path=${encodeURIComponent(filePath)}`;
  const headers = new Headers();
  if (options.range) headers.set("range", options.range);
  return {
    url,
    method,
    headers,
    signal: new AbortController().signal,
    nextUrl: new URL(url),
  } as unknown as import("next/server").NextRequest;
}

async function bytes(response: Response): Promise<string> {
  return Buffer.from(await response.arrayBuffer()).toString("utf8");
}

test("stream: serves an open-ended range", async () => {
  const response = await streamGet(
    request("stream", FILE, { range: "bytes=5-" })
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 5-9/10");
  assert.equal(response.headers.get("content-length"), "5");
  assert.equal(await bytes(response), "56789");
});

test("stream: serves a suffix range", async () => {
  const response = await streamGet(
    request("stream", FILE, { range: "bytes=-4" })
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 6-9/10");
  assert.equal(await bytes(response), "6789");
});

test("stream: caps an oversized suffix range to the whole file", async () => {
  const response = await streamGet(
    request("stream", FILE, { range: "bytes=-500" })
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-9/10");
  assert.equal(await bytes(response), "0123456789");
});

for (const range of [
  "items=0-1",
  "bytes=-",
  "bytes=abc-def",
  "bytes=10-",
  "bytes=8-4",
  "bytes=-0",
  "bytes=999999999999999999999999-",
  "bytes=-999999999999999999999999",
  "bytes=1-999999999999999999999999",
]) {
  test(`stream: rejects invalid or unsatisfiable range ${range}`, async () => {
    const response = await streamGet(request("stream", FILE, { range }));
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */10");
    assert.equal(await bytes(response), "");
  });
}

test("stream: takes the first satisfiable range from a multi-range request", async () => {
  const response = await streamGet(
    request("stream", FILE, { range: "bytes=1-2, 7-8" })
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 1-2/10");
  assert.equal(await bytes(response), "12");
});

test("stream: returns an empty 200 response for a zero-length file", async () => {
  const response = await streamGet(request("stream", EMPTY));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "0");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(await bytes(response), "");
});

test("stream: rejects a range against a zero-length file", async () => {
  const response = await streamGet(
    request("stream", EMPTY, { range: "bytes=0-" })
  );
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */0");
});

test("stream: HEAD mirrors GET metadata without a body", async () => {
  const response = await streamHead(
    request("stream", FILE, { method: "HEAD", range: "bytes=5-" })
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 5-9/10");
  assert.equal(response.headers.get("content-length"), "5");
  assert.equal(await bytes(response), "");
});

test("stream: HEAD errors are bodyless", async () => {
  const missing = join(ROOT, "missing-head.mp4");
  const response = await streamHead(
    request("stream", missing, { method: "HEAD" })
  );
  assert.equal(response.status, 404);
  assert.equal(await bytes(response), "");
});

test("stream: a file deleted before the request returns 404", async () => {
  const missing = join(ROOT, "deleted.mp3");
  const response = await streamGet(request("stream", missing));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "File not found" });
});

test("download and stream use the same MIME detector for every known extension", async () => {
  for (const [extension, expected] of Object.entries(MIME_TYPES)) {
    const filePath = join(ROOT, `mime.${extension}`);
    writeFileSync(filePath, "x");
    const [download, stream] = await Promise.all([
      downloadGet(request("download", filePath)),
      streamHead(request("stream", filePath, { method: "HEAD" })),
    ]);
    assert.equal(mimeTypeFor(filePath), expected, extension);
    assert.equal(download.headers.get("content-type"), expected, extension);
    assert.equal(stream.headers.get("content-type"), expected, extension);
  }
});

test("media extensions classify consistently and non-media stays out of the viewer", () => {
  for (const extension of Object.keys(MIME_TYPES)) {
    const mime = MIME_TYPES[extension];
    const expected = mime.startsWith("image/")
      ? "image"
      : mime.startsWith("video/")
        ? "video"
        : mime.startsWith("audio/")
          ? "audio"
          : null;
    assert.equal(mediaKindFor(`FILE.${extension.toUpperCase()}`), expected);
  }
  assert.equal(mediaKindFor("README"), null);
  assert.equal(mediaKindFor("archive.bin"), null);
});

test("binary and truncated media remain impossible to save", () => {
  assert.match(
    saveRefusalFor({ isBinary: true, truncated: false }) ?? "",
    /cannot be saved/
  );
  assert.match(
    saveRefusalFor({ isBinary: false, truncated: true }) ?? "",
    /cannot be saved/
  );
  assert.match(
    saveRefusalFor({ path: "/tmp/vector.svg", isBinary: false, truncated: false }) ?? "",
    /cannot be saved/
  );
  assert.equal(
    saveRefusalFor({ path: "/tmp/readme.txt", isBinary: false, truncated: false }),
    null
  );
});

test("zoom-to-cursor preserves the image-space point for large offsets", () => {
  const previousZoom = 2;
  const nextZoom = clampMediaZoom(previousZoom * 1.75);
  const offset = { x: -12_500, y: 8_000 };
  const cursor = { x: 420, y: -275 };
  const next = offsetAfterZoom(offset, cursor, previousZoom, nextZoom);

  const imagePointBefore = {
    x: (cursor.x - offset.x) / previousZoom,
    y: (cursor.y - offset.y) / previousZoom,
  };
  const imagePointAfter = {
    x: (cursor.x - next.x) / nextZoom,
    y: (cursor.y - next.y) / nextZoom,
  };
  assert.ok(Math.abs(imagePointAfter.x - imagePointBefore.x) < 1e-9);
  assert.ok(Math.abs(imagePointAfter.y - imagePointBefore.y) < 1e-9);
  assert.equal(clampMediaZoom(100), 12);
  assert.equal(clampMediaZoom(0), 0.2);
});
