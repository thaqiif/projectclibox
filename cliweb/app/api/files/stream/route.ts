import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { Readable } from "stream";
import { mediaKindFor, mimeTypeFor } from "@/lib/media-mime";

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
//
// Unlike download, this route serves bytes *inline* with the file's inferred
// Content-Type, so it is restricted to the media extensions the viewer
// actually renders. Without that gate, a workspace-supplied .html or .svg
// opened at this URL would execute script in the app origin (the origin that
// also exposes /api/files/*, terminals and tmux). nosniff plus a CSP sandbox
// are sent as defense in depth for SVG, which is scriptable even in an <img>.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ByteRange {
  start: number;
  end: number; // inclusive
}

/**
 * Parse a single-range Range header ("bytes=a-b", "bytes=a-", "bytes=-n").
 * Returns null when the header is absent, uses an unknown unit, or is
 * malformed: RFC 9110 14.2 says to ignore a Range field the server cannot
 * satisfy syntactically (and an unknown range unit MUST be ignored), so those
 * requests get the full 200 representation. Returns "unsatisfiable" for a
 * range-spec that is well formed but has no satisfiable member (416).
 * Multi-range requests are served as their first satisfiable member (a
 * single-range response is valid for any range set); no browser sends them
 * for media playback, but one that does still gets bytes rather than a 416
 * when only its first member is out of bounds.
 *
 * Numerals are deliberately NOT bounded by Number.isSafeInteger. RFC 9110
 * 14.1.2 requires that recipients "anticipate potentially large decimal
 * numerals and prevent parsing errors due to integer conversion overflows",
 * and defines the out-of-range interpretations: a last-pos at or past the
 * length means the remainder of the representation, and a suffix-length
 * longer than the representation means the whole representation. Clamping
 * (rather than rejecting) is what keeps bytes=0-999999999 and
 * bytes=0-999999999999999999999999 behave identically.
 */
function parseSingleRange(
  member: string,
  size: number
): ByteRange | null | "unsatisfiable" {
  // Range units are case-insensitive ("Bytes=0-1" is valid).
  // In a multi-member set only the first member carries the unit
  // ("bytes=0-1, 5-6"), so the prefix is optional here.
  const match = /^(?:bytes=)?(\d*)-(\d*)$/i.exec(member);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    // Suffix range: last N bytes. A zero suffix-length is not satisfiable
    // (RFC 9110 14.1.2); a length past the representation is clamped to it.
    const suffix = Number(rawEnd);
    if (suffix === 0) return "unsatisfiable";
    if (size === 0) return "unsatisfiable";
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }

  // first-pos at or past the length is the one genuinely unsatisfiable case;
  // it also catches a numeral too large for a double (Infinity >= size).
  const start = Number(rawStart);
  if (size === 0 || start >= size) return "unsatisfiable";
  // last-pos past the length (or absent) means "through the end".
  const parsedEnd = rawEnd === "" ? size - 1 : Number(rawEnd);
  const end = Math.min(parsedEnd, size - 1);
  if (end < start) return "unsatisfiable";
  return { start, end };
}

function parseRange(
  header: string | null,
  size: number
): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  let sawUnsatisfiable = false;
  for (const member of header.split(",")) {
    const parsed = parseSingleRange(member.trim(), size);
    if (parsed === null) continue;
    if (parsed !== "unsatisfiable") return parsed;
    sawUnsatisfiable = true;
  }
  // Nothing servable: 416 only when a member was well formed but out of
  // bounds; otherwise the whole header is unparseable and gets ignored.
  return sawUnsatisfiable ? "unsatisfiable" : null;
}

/**
 * Open a descriptor directly instead of using fs.promises.open: a FileHandle
 * would close the same descriptor again during garbage collection, which can
 * hit a recycled fd. A raw descriptor is owned by exactly one code path.
 */
function openReadOnly(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    fs.open(
      filePath,
      fs.constants.O_RDONLY | fs.constants.O_NONBLOCK,
      (error, fd) => (error ? reject(error) : resolve(fd))
    );
  });
}

function closeQuietly(fd: number) {
  try {
    fs.closeSync(fd);
  } catch {
    /* already closed by the read stream */
  }
}

function statDescriptor(fd: number): Promise<fs.Stats> {
  // fs.promises has no fstat; this keeps the fstat off the event loop.
  return new Promise((resolve, reject) => {
    fs.fstat(fd, (error, stat) => (error ? reject(error) : resolve(stat)));
  });
}

function errorResponse(message: string, status: number, headers: HeadersInit) {
  return NextResponse.json({ error: message }, { status, headers });
}

async function streamFile(request: NextRequest, includeBody: boolean) {
  let fd: number | null = null;
  const baseHeaders: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    // Neutralizes script in inline SVG documents served from this origin.
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "no-store",
  };

  try {
    const requested = request.nextUrl.searchParams.get("path");

    if (!requested) {
      return errorResponse("Path parameter is required", 400, baseHeaders);
    }

    // Same expansion + traversal rule as /api/files/download.
    const expandedPath = requested.replace(
      /^~(?=\/|$)/,
      process.env.HOME || os.homedir()
    );
    if (expandedPath.split(path.sep).includes("..")) {
      return errorResponse("Path traversal is not allowed", 400, baseHeaders);
    }
    const filePath = path.resolve(expandedPath);

    // Open before stat so the size used for Content-Length and the range can
    // never disagree with the bytes actually read (a shrinking file would
    // otherwise promise more bytes than the stream delivers). O_NONBLOCK is a
    // no-op for regular files and stops a FIFO in the workspace from blocking
    // the open until some other process writes to it.
    try {
      fd = await openReadOnly(filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return errorResponse("File not found", 404, baseHeaders);
      }
      if (code === "EISDIR") {
        return errorResponse("Cannot stream a directory", 400, baseHeaders);
      }
      if (code === "EACCES" || code === "EPERM") {
        return errorResponse("File is not readable", 403, baseHeaders);
      }
      throw error;
    }

    const stat = await statDescriptor(fd);

    if (stat.isDirectory()) {
      closeQuietly(fd);
      fd = null;
      return errorResponse("Cannot stream a directory", 400, baseHeaders);
    }
    if (!stat.isFile()) {
      // FIFOs, sockets and devices would block or misreport their size.
      closeQuietly(fd);
      fd = null;
      return errorResponse("Cannot stream this file type", 415, baseHeaders);
    }

    const kind = mediaKindFor(filePath);
    if (!kind) {
      closeQuietly(fd);
      fd = null;
      return errorResponse("Only media files can be streamed", 415, baseHeaders);
    }

    const size = stat.size;
    const range = parseRange(request.headers.get("range"), size);
    const headers: Record<string, string> = {
      ...baseHeaders,
      "Content-Type": mimeTypeFor(filePath),
      "Accept-Ranges": "bytes",
    };

    if (range === "unsatisfiable") {
      closeQuietly(fd);
      fd = null;
      return new NextResponse(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    }

    const slice: ByteRange = range ?? { start: 0, end: size - 1 };
    const length = size === 0 ? 0 : slice.end - slice.start + 1;

    headers["Content-Length"] = String(length);
    if (range) {
      headers["Content-Range"] = `bytes ${slice.start}-${slice.end}/${size}`;
    }

    // HEAD and empty files never allocate a read stream. A ranged request for
    // an empty file was already rejected above, so the empty response is 200.
    if (!includeBody || length === 0) {
      closeQuietly(fd);
      fd = null;
      return new NextResponse(null, { status: range ? 206 : 200, headers });
    }

    const nodeStream = fs.createReadStream(filePath, {
      fd,
      start: slice.start,
      end: slice.end,
      // The stream owns the descriptor from here and closes it exactly once,
      // whether it ends, errors or is destroyed by an aborted request.
      autoClose: true,
    });
    fd = null;
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
    return errorResponse("Failed to stream file", 500, baseHeaders);
  } finally {
    if (fd !== null) closeQuietly(fd);
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
