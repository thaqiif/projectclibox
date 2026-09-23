import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/** Response cap: files larger than this are rejected rather than buffered. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Small extension -> Content-Type map; anything else is
 * application/octet-stream so it behaves as a generic binary download.
 */
const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  json: "application/json",
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  jsx: "text/javascript",
  css: "text/css",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  xml: "application/xml",
  yml: "application/x-yaml",
  yaml: "application/x-yaml",
  py: "text/x-python",
  sh: "application/x-sh",
  zip: "application/zip",
  gz: "application/gzip",
  tgz: "application/gzip",
  tar: "application/x-tar",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
};

function mimeTypeFor(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * GET /api/files/download?path=...
 * Read a file and return the raw bytes as an attachment download.
 */
export async function GET(request: NextRequest) {
  try {
    const requested = request.nextUrl.searchParams.get("path");

    if (!requested) {
      return NextResponse.json(
        { error: "Path parameter is required" },
        { status: 400 }
      );
    }

    // Expand ~ to home directory (same convention as /api/files/content)
    const expandedPath = requested.replace(/^~(?=\/|$)/, process.env.HOME || os.homedir());
    const filePath = path.resolve(expandedPath);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      return NextResponse.json(
        { error: "Cannot download a directory" },
        { status: 400 }
      );
    }

    if (stat.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `File too large to download (${(stat.size / 1024 / 1024).toFixed(2)}MB). Maximum size: 10MB`,
        },
        { status: 413 }
      );
    }

    const buffer = await fs.promises.readFile(filePath);
    const filename = path
      .basename(filePath)
      .replace(/["\\\r\n]/g, "_");

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mimeTypeFor(filePath),
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Error downloading file:", error);
    return NextResponse.json(
      { error: "Failed to read file" },
      { status: 500 }
    );
  }
}
