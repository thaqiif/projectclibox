import { statSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { readFileContent, writeFileContent, DEFAULT_MAX_READ_BYTES } from "@/lib/files";
import { guardJsonSameOrigin } from "@/lib/route-guards";

function expandFilePath(path: string): string | null {
  const expanded = path.replace(/^~(?=\/|$)/, process.env.HOME || "");
  // Traversal is rejected on the raw expanded string before resolve: resolve
  // absorbs ".." segments, so a post-resolve check can never catch them.
  // Same rule as /api/files/ops and upload-temp.
  if (expanded.split("/").includes("..")) {
    return null;
  }
  return expanded;
}

/**
 * GET /api/files/content?path=...
 * Read file contents. Response includes mtimeMs (server stat mtime) and
 * size so clients can detect concurrent modification on save.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json(
        { error: "Path parameter is required" },
        { status: 400 }
      );
    }

    // Expand ~ to home directory, rejecting traversal up front
    const expandedPath =
      expandFilePath(path);
    if (expandedPath === null) {
      return NextResponse.json(
        { error: "Path traversal is not allowed" },
        { status: 400 }
      );
    }

    // Stat before reading so the client gets the mtime of the content it
    // is about to receive. Throws for missing/unreadable files, which the
    // catch below reports as a 500.
    const stat = statSync(expandedPath);
    const result = readFileContent(expandedPath);

    return NextResponse.json({
      ...result,
      path: expandedPath,
      mtimeMs: stat.mtimeMs,
    });
  } catch (error) {
    console.error("Error reading file:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read file" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/files/content
 * Write file contents
 *
 * Conflict detection: if the body includes { expectedMtimeMs }, the current
 * server mtime is compared against it. On mismatch the write is rejected
 * with 409 { error: "conflict", serverMtimeMs } instead of overwriting.
 * Back-compat: when expectedMtimeMs is ABSENT the write is forced (old
 * always-overwrite behavior) so existing clients that never send it are
 * unaffected. { force: true } is the explicit opt-out for clients that do
 * send expectedMtimeMs and have decided to overwrite anyway (e.g. after a
 * user confirms a conflict dialog). A missing on-disk file is treated as
 * "no conflict" so new-file creation keeps working.
 *
 * Binary guard: writes onto a file whose current on-disk content is binary
 * are refused with 415 unless the caller passes BOTH { force: true } AND
 * { allowBinaryOverwrite: true }, which only the conflict-overwrite
 * confirmation flow sends after the user explicitly confirmed. This stops a
 * save of a placeholder string from destroying a binary file.
 */
export async function POST(request: NextRequest) {
  const guard = guardJsonSameOrigin(request);
  if (guard) return guard;

  try {
    const body = await request.json();
    const { path, content, expectedMtimeMs, force, allowBinaryOverwrite } =
      body;

    if (!path) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    if (content === undefined) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    // Expand ~ to home directory, rejecting traversal up front
    const expandedPath = expandFilePath(path);
    if (expandedPath === null) {
      return NextResponse.json(
        { error: "Path traversal is not allowed" },
        { status: 400 }
      );
    }

    if (typeof expectedMtimeMs === "number" && force !== true) {
      try {
        const stat = statSync(expandedPath);
        if (stat.mtimeMs !== expectedMtimeMs) {
          return NextResponse.json(
            { error: "conflict", serverMtimeMs: stat.mtimeMs },
            { status: 409 }
          );
        }
      } catch (error) {
        const code =
          error instanceof Error && "code" in error
            ? (error as NodeJS.ErrnoException).code
            : undefined;
        if (code !== "ENOENT") throw error;
        // File does not exist yet: nothing to conflict with, allow create.
      }
    }

    try {
      const result = writeFileContent(expandedPath, content, {
        // allowBinaryOverwrite is honored only from the explicit
        // force-overwrite path (conflict dialog); anything else is refused
        // by writeFileContent with "refusing to overwrite binary file with
        // text", mapped to 415 below.
        allowBinaryOverwrite: force === true && allowBinaryOverwrite === true,
        // Parity with the read cap: a file that GET can return as savable
        // text must be re-savable. The 1MB default here silently rejected
        // edits of any text file between 1MB and the 2MB read cap.
        maxSize: DEFAULT_MAX_READ_BYTES,
      });

      return NextResponse.json({
        ...result,
        path: expandedPath,
        // Post-write mtime so clients can update their captured value and
        // save again later without a false conflict against their own write.
        mtimeMs: statSync(expandedPath).mtimeMs,
      });
    } catch (writeError) {
      const message =
        writeError instanceof Error
          ? writeError.message
          : "Failed to write file";
      if (message === "refusing to overwrite binary file with text") {
        return NextResponse.json(
          {
            error:
              "refusing to overwrite binary file with text. Re-open the file to view or download it instead.",
          },
          { status: 415 }
        );
      }
      if (message.startsWith("Content too large")) {
        return NextResponse.json({ error: message }, { status: 413 });
      }
      throw writeError;
    }
  } catch (error) {
    console.error("Error writing file:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to write file",
      },
      { status: 500 }
    );
  }
}
