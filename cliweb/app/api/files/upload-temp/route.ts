import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";

/**
 * Accept a user-supplied target directory for uploads.
 *
 * Must be absolute (after ~ expansion) and must not contain any ".."
 * segments: resolving the path would silently absorb them, and this route
 * writes wherever it is told, so traversal-prone input is rejected outright
 * rather than resolved away.
 */
function sanitizeTargetDir(input: unknown): string | null {
  if (typeof input !== "string" || input.trim() === "") return null;

  const expanded = input.replace(/^~(?=\/|$)/, os.homedir());

  if (!path.isAbsolute(expanded)) return null;
  if (expanded.split(path.sep).includes("..")) return null;

  return path.resolve(expanded);
}

function safeFilename(input: unknown): string {
  return (
    (typeof input === "string" ? input.replace(/[^a-zA-Z0-9._-]/g, "_") : "")
      .replace(/^\.+/, "") // no hidden/traversal-ish leading dots
      .trim() || "file"
  );
}

function decodeBase64(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

export async function POST(request: Request) {
  try {
    // Cheap gate first: a Content-Length that already exceeds the limit can
    // bail before the body is parsed. Best-effort only — chunked or encoding
    // without a length is still caught by the decoded-size check below.
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "File too large" },
        { status: 413 }
      );
    }

    const { filename, base64, mimeType, targetDir, overwrite } =
      await request.json();

    // base64 inflates by 4/3, so the decoded payload is what must fit under
    // the limit. Checking the raw string would let a ~1.33x oversized file
    // through.
    if (
      typeof base64 !== "string" ||
      base64.length * 0.75 > MAX_UPLOAD_BYTES
    ) {
      return NextResponse.json(
        { error: "File too large" },
        { status: 413 }
      );
    }

    if (!base64) {
      return NextResponse.json({ error: "No image data" }, { status: 400 });
    }

    const targetDirectory = sanitizeTargetDir(targetDir);

    if (targetDir != null && !targetDirectory) {
      return NextResponse.json(
        { error: "targetDir must be an absolute path without .. segments" },
        { status: 400 }
      );
    }

    if (targetDirectory) {
      // Drop-in upload: land where the user was working. mkdir -p so a
      // directory that vanished mid-session still gets the file.
      fs.mkdirSync(targetDirectory, { recursive: true });

      let finalName = safeFilename(filename);
      const filePath = path.join(targetDirectory, finalName);

      // Prefer the clean name; only touch the filesystem content that is
      // already there when the client explicitly asked for an overwrite.
      if (fs.existsSync(filePath) && !overwrite) {
        finalName = `${Date.now()}-${finalName}`;
      }

      const writePath = path.join(targetDirectory, finalName);
      fs.writeFileSync(writePath, decodeBase64(base64));

      return NextResponse.json({ path: writePath });
    }

    // Create temp directory for screenshots if it doesn't exist
    const tempDir = path.join(os.tmpdir(), "cliweb-screenshots");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Generate unique filename
    const ext = mimeType?.split("/")[1] || "png";
    const safeName = filename?.replace(/[^a-zA-Z0-9.-]/g, "_") || "screenshot";
    const uniqueName = `${Date.now()}-${safeName}`;
    const finalName = uniqueName.endsWith(`.${ext}`)
      ? uniqueName
      : `${uniqueName}.${ext}`;
    const filePath = path.join(tempDir, finalName);

    // Decode base64 and write file
    const buffer = decodeBase64(base64);
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({ path: filePath });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to save image" },
      { status: 500 }
    );
  }
}
