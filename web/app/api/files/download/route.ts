import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { mimeTypeFor } from "@/lib/media-mime";

/** Response cap: files larger than this are rejected rather than buffered. */
const MAX_BYTES = 10 * 1024 * 1024;

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

    // Expand ~ to home directory (same convention as /api/files/content);
    // reject traversal on the raw expanded string before resolve (resolve
    // absorbs ".." segments). Same rule as ops and upload-temp.
    const expandedPath = requested.replace(/^~(?=\/|$)/, process.env.HOME || os.homedir());
    if (expandedPath.split(path.sep).includes("..")) {
      return NextResponse.json(
        { error: "Path traversal is not allowed" },
        { status: 400 }
      );
    }
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
