import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as downloadGet } from "../app/api/files/download/route";
import { GET as streamGet, HEAD as streamHead } from "../app/api/files/stream/route";
import { MIME_TYPES, mediaKindFor, mimeTypeFor } from "./media-mime";
import {
  clampMediaOffset,
  clampMediaZoom,
  offsetAfterZoom,
} from "./media-viewer";
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
  "bytes=10-",
  "bytes=8-4",
  "bytes=-0",
  "bytes=999999999999999999999999-",
  "bytes=-999999999999999999999999",
  "bytes=1-999999999999999999999999",
]) {
  test(`stream: rejects unsatisfiable range ${range}`, async () => {
    const response = await streamGet(request("stream", FILE, { range }));
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */10");
    assert.equal(await bytes(response), "");
  });
}

for (const range of ["items=0-1", "bytes=-", "bytes=abc-def", "bytes=1-2-3"]) {
  test(`stream: ignores a Range it cannot parse (${range}) and serves 200`, async () => {
    const response = await streamGet(request("stream", FILE, { range }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-range"), null);
    assert.equal(await bytes(response), "0123456789");
  });
}

test("stream: accepts a case-insensitive range unit", async () => {
  const response = await streamGet(
    request("stream", FILE, { range: "Bytes=0-1" })
  );
  assert.equal(response.status, 206);
  assert.equal(await bytes(response), "01");
});

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

test("stream: refuses to serve non-media inline (same-origin script risk)", async () => {
  for (const name of ["page.html", "notes.txt", "app.js", "data.json"]) {
    const filePath = join(ROOT, name);
    writeFileSync(filePath, "<script>alert(1)</script>");
    const response = await streamGet(request("stream", filePath));
    assert.equal(response.status, 415, name);
    assert.deepEqual(
      await response.json(),
      { error: "Only media files can be streamed" },
      name
    );
  }
});

test("stream: scriptable SVG stays media but is sandboxed", async () => {
  const filePath = join(ROOT, "icon.svg");
  writeFileSync(filePath, "<svg onload=\"alert(1)\"></svg>");
  const response = await streamGet(request("stream", filePath));
  // SVG is a media type the viewer renders, so it must stay servable...
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/svg+xml");
  // ...but never as a script-capable same-origin document.
  assert.equal(response.headers.get("content-security-policy"), "sandbox");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("stream: media responses are nosniff and sandboxed", async () => {
  const response = await streamGet(request("stream", FILE));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "sandbox");
  const rejected = await streamGet(request("stream", EMPTY, { range: "bytes=0-" }));
  assert.equal(rejected.headers.get("x-content-type-options"), "nosniff");
});

test("stream: a directory is refused with 400 and a non-file with 415", async () => {
  const directory = await streamGet(request("stream", ROOT));
  assert.equal(directory.status, 400);
  const fifo = join(ROOT, "pipe.mp3");
  execFileSync("mkfifo", [fifo]);
  const nonFile = await streamGet(request("stream", fifo));
  assert.equal(nonFile.status, 415);
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
    // Only media is served inline; everything else is download-only.
    if (mediaKindFor(filePath) === null) {
      assert.equal(stream.status, 415, extension);
      continue;
    }
    assert.equal(stream.status, 200, extension);
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

test("every media path the viewer can display is impossible to save", () => {
  for (const extension of Object.keys(MIME_TYPES)) {
    if (mediaKindFor(`FILE.${extension}`) === null) continue;
    // The viewer only replaces the editor for binary or truncated files, and
    // the hook refuses both, so displayed media is never editable.
    assert.match(
      saveRefusalFor({ isBinary: true, truncated: false }) ?? "",
      /cannot be saved/,
      extension
    );
    assert.match(
      saveRefusalFor({ isBinary: false, truncated: true }) ?? "",
      /cannot be saved/,
      extension
    );
  }
  assert.equal(saveRefusalFor({ isBinary: false, truncated: false }), null);
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

test("pan clamping keeps a dragged image partly on screen", () => {
  const container = { width: 1000, height: 800 };
  const fitted = { width: 500, height: 400 };

  // Zoomed 4x: 2000x1600 scaled, so a generous pan is allowed but capped.
  const zoomed = clampMediaOffset(
    { x: 100_000, y: -100_000 },
    fitted,
    container,
    4
  );
  assert.equal(zoomed.x, (2000 + 1000) / 2 - 250);
  assert.equal(zoomed.y, -((1600 + 800) / 2 - 200));

  // At 1x an image smaller than the viewport may still be moved, but never
  // far enough to leave the container entirely.
  const atOne = clampMediaOffset({ x: 100_000, y: 0 }, fitted, container, 1);
  assert.equal(atOne.x, (500 + 1000) / 2 - 250);
  assert.ok(atOne.x - 250 < container.width / 2);

  // Small pans pass through untouched.
  assert.deepEqual(
    clampMediaOffset({ x: 10, y: -20 }, fitted, container, 2),
    { x: 10, y: -20 }
  );
});
