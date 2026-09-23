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
 * Returns null when absent/unparseable (serve 200 full), and "unsatisfiable"
 * when syntactically valid but outside the file (serve 416). Multi-range
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
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (suffix === 0) return "unsatisfiable";
    const start = Math.max(size - Math.min(suffix, size), 0);
    if (size === 0) return "unsatisfiable";
    return { start, end: size - 1 };
  }

  const start = Number(rawStart);
  if (size === 0 || start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return "unsatisfiable";
  return { start, end };
}

export async function GET(request: NextRequest) {
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

    // Empty file: no read stream needed, an empty body with Content-Length: 0
    // is the correct response for both 200 and 206.
    if (length === 0) {
      return new NextResponse(null, { status: range ? 206 : 200, headers });
    }

    const nodeStream = fs.createReadStream(filePath, {
      start: slice.start,
      end: slice.end,
    });
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
