import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { buildZipFromDirectory, ZipLimitError } from "@/lib/zip";

/**
 * GET /api/files/zip?path=<dir>
 * Build a zip archive of the directory (STORE mode, no compression) and
 * return it as an attachment download. Mirrors /api/files/download: plain
 * GET without same-origin guards, since Origin is absent for same-origin
 * navigations and the endpoint is read-only over the same path surface as
 * the rest of /api/files.
 *
 * Bounds: recursion depth 20, total uncompressed size 500MB (413 over),
 * symlinks skipped, build/VCS directories (node_modules, .git, ...) excluded.
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

    // Expand ~ to home directory (same convention as /api/files/download)
    const expandedPath = requested.replace(
      /^~(?=\/|$)/,
      process.env.HOME || os.homedir()
    );
    const dirPath = path.resolve(expandedPath);

    if (!fs.existsSync(dirPath)) {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    if (!fs.statSync(dirPath).isDirectory()) {
      return NextResponse.json(
        { error: "Path is not a directory" },
        { status: 400 }
      );
    }

    const archive = buildZipFromDirectory(dirPath);

    const filename =
      path
        .basename(dirPath)
        .replace(/["\\\r\n]/g, "_")
        .replace(/\.zip$/i, "") + ".zip";

    return new NextResponse(new Uint8Array(archive), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(archive.byteLength),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ZipLimitError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Error building zip:", error);
    return NextResponse.json({ error: "Failed to build zip archive" }, { status: 500 });
  }
}
