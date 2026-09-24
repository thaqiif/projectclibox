import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { Readable } from "stream";
import { mimeTypeFor } from "@/lib/media-mime";

/**
 * GET /api/files/stream?path=...
 *
 * Range-aware media streaming for the in-browser viewer (images, video,
 * audio). Unlike /api/files/download this never buffers the whole file:
 * each request reads only the requested byte slice with a fs read stream
 * and pipes it into the response body, so large media plays without any
 * download step and <video>/<audio> seeking works (seeking issues a new
 * Range request).
 */

// Mirror the download route's guards (~ expansion, traversal rejection,
// 404, directory refusal). No size cap here: the point is streaming.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ByteRange {
  start: number;
  end: number; // inclusive
}

/**
 * Parse a single-range Range header ("bytes=a-b", "bytes=a-", "bytes=-n").
 * Returns null only when absent (serve 200 full), and "unsatisfiable" for an
 * invalid or out-of-bounds request (serve 416). Multi-range
 * requests are collapsed to their first range; no browser sends them for
 * media playback.
 */
function parseRange(
  header: string | null,
  size: number
): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const first = header.split(",")[0].trim();
  const match = /^bytes=(\d*)-(\d*)$/.exec(first);
  if (!match) return "unsatisfiable";
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return "unsatisfiable";

  if (rawStart === "") {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return "unsatisfiable";
    const start = Math.max(size - Math.min(suffix, size), 0);
    if (size === 0) return "unsatisfiable";
    return { start, end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start)) return "unsatisfiable";
  if (size === 0 || start >= size) return "unsatisfiable";
  const parsedEnd = rawEnd === "" ? size - 1 : Number(rawEnd);
  if (!Number.isSafeInteger(parsedEnd)) return "unsatisfiable";
  const end = Math.min(parsedEnd, size - 1);
  if (end < start) return "unsatisfiable";
  return { start, end };
}

async function streamFile(request: NextRequest, includeBody: boolean) {
  try {
    const requested = request.nextUrl.searchParams.get("path");

    if (!requested) {
      return NextResponse.json(
        { error: "Path parameter is required" },
        { status: 400 }
      );
    }

    // Same expansion + traversal rule as /api/files/download.
    const expandedPath = requested.replace(
      /^~(?=\/|$)/,
      process.env.HOME || os.homedir()
    );
    if (expandedPath.split(path.sep).includes("..")) {
      return NextResponse.json(
        { error: "Path traversal is not allowed" },
        { status: 400 }
      );
    }
    const filePath = path.resolve(expandedPath);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (stat.isDirectory()) {
      return NextResponse.json(
        { error: "Cannot stream a directory" },
        { status: 400 }
      );
    }

    const size = stat.size;
    const range = parseRange(request.headers.get("range"), size);
    const baseHeaders: Record<string, string> = {
      "Content-Type": mimeTypeFor(filePath),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    };

    if (range === "unsatisfiable") {
      return new NextResponse(null, {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
      });
    }

    const slice: ByteRange = range ?? { start: 0, end: size - 1 };
    const length = size === 0 ? 0 : slice.end - slice.start + 1;

    const headers: Record<string, string> = { ...baseHeaders };
    headers["Content-Length"] = String(length);
    if (range) {
      headers["Content-Range"] = `bytes ${slice.start}-${slice.end}/${size}`;
    }

    // HEAD and empty files never allocate a read stream. A ranged request for
    // an empty file was already rejected above, so the empty response is 200.
    if (!includeBody || length === 0) {
      return new NextResponse(null, { status: range ? 206 : 200, headers });
    }

    const nodeStream = fs.createReadStream(filePath, {
      start: slice.start,
      end: slice.end,
    });
    const abort = () => nodeStream.destroy();
    request.signal.addEventListener("abort", abort, { once: true });
    nodeStream.once("close", () =>
      request.signal.removeEventListener("abort", abort)
    );
    const body = Readable.toWeb(
      nodeStream
    ) as unknown as ReadableStream<Uint8Array>;

    return new NextResponse(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    console.error("Error streaming file:", error);
    return NextResponse.json(
      { error: "Failed to stream file" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return streamFile(request, true);
}

/** Browsers probe media metadata with HEAD before deciding how to load it. */
export async function HEAD(request: NextRequest) {
  const response = await streamFile(request, false);
  return new NextResponse(null, {
    status: response.status,
    headers: response.headers,
  });
}
