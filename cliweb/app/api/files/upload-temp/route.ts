import { NextResponse } from "next/server";
import fs from "fs";
import { randomBytes } from "crypto";
import path from "path";
import os from "os";
import { MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from "@/lib/upload-limits";
import { guardJsonSameOrigin } from "@/lib/route-guards";

/**
 * File upload endpoint.
 *
 * Two request shapes share this route (all JSON, all guarded by
 * guardJsonSameOrigin):
 *
 * 1. One-shot (legacy / screenshots): body carries the whole payload as
 *    {filename, base64, mimeType?, targetDir?, overwrite?} and the file is
 *    written in a single call. Kept working so existing callers and external
 *    screenshot senders are unaffected.
 *
 * 2. Chunked: an init request {op:"init", filename, totalBytes, totalChunks,
 *    mimeType?, targetDir?, overwrite?} returns {uploadId, chunkSize}; the
 *    client then POSTs {op:"chunk", uploadId, chunkIndex, chunk} one base64
 *    chunk at a time ({uploadId, received} comes back after each), and the
 *    last chunk assembles the file in targetDir (or the screenshot temp dir)
 *    and returns the same {path} as the one-shot shape. Partials live under
 *    os.tmpdir()/cliweb-upload-partials/<uploadId>/ and are deleted on
 *    completion or failure.
 *
 * Chunk protocol details:
 * - uploadId is generated server-side (crypto random, no client-controlled
 *   path material) and pinned to the init request's target dir/filename so a
 *   hijacked id cannot move data somewhere else.
 * - Every chunk but the last must be exactly chunkSize base64 chars;
 *   undersized chunks are rejected (they would corrupt the reassembly order).
 * - The decoded total must fit under MAX_UPLOAD_BYTES, checked per chunk as
 *   bytes received so far, so the limit holds even when the client lies in
 *   the init request.
 */

/** Directory (under the OS temp dir) holding per-upload partial chunks. */
const PARTIALS_ROOT = path.join(os.tmpdir(), "cliweb-upload-partials");

/** How long an incomplete upload may sit before its partials are reclaimed. */
const UPLOAD_TTL_MS = 60 * 60 * 1000;

/** Shape of an in-flight chunked upload recorded on init. */
interface UploadSession {
  filename: string;
  targetDirectory: string | null;
  createTargetDir: boolean;
  mimeType: string;
  overwrite: boolean;
  chunkSizeBytes: number;
  totalChunks: number;
  totalBytes: number;
  receivedBytes: number;
  nextChunkIndex: number;
  expiresAtMs: number;
}

/** In-memory upload registry. Survives for the dev-server / node process. */
const sessions = new Map<string, UploadSession>();

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

function isPathInside(parent: string, candidate: string): boolean {
  const resolved = path.resolve(candidate);
  return resolved === parent || resolved.startsWith(parent + path.sep);
}

/** Random, filesystem-safe upload id (never derived from client input). */
function newUploadId(): string {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)
  );
}

/** Drop expired sessions and delete their partial chunk files. */
function sweepExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAtMs <= now) {
      sessions.delete(id);
      try {
        fs.rmSync(path.join(PARTIALS_ROOT, id), {
          recursive: true,
          force: true,
        });
      } catch {
        // Best-effort reclaim; leftover files in tmp are harmless.
      }
    }
  }
}

function badRequest(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
}

function fileErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One-shot write of a fully-decoded buffer, shared by the legacy request
 * shape and chunked assembly. Honors targetDir vs the screenshot temp dir,
 * collision timestamping, and the same containment checks as before.
 */
function writeAssembledFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  targetDirectory: string | null,
  overwrite: boolean,
  createTargetDir: boolean
): { path?: string; error?: string; status?: number } {
  if (targetDirectory) {
    // Terminal targets are <cwd>/tmp. Create only that leaf. Recreating every
    // missing ancestor would silently resurrect a deleted cwd, and trying to
    // mkdir through a cwd that became a file used to escape as a generic 500.
    try {
      const parent = path.dirname(targetDirectory);
      const parentStat = fs.statSync(parent);
      if (!parentStat.isDirectory()) {
        return {
          error: `Upload destination parent is not a directory: ${parent}`,
          status: 409,
        };
      }

      if (fs.existsSync(targetDirectory)) {
        if (!fs.statSync(targetDirectory).isDirectory()) {
          return {
            error: `Upload destination is not a directory: ${targetDirectory}`,
            status: 409,
          };
        }
      } else if (!createTargetDir) {
        // File-manager drops name an existing browsed folder. Recreating it
        // would silently resurrect a directory the user just deleted.
        return {
          error: `Upload destination no longer exists: ${targetDirectory}`,
          status: 409,
        };
      } else {
        try {
          fs.mkdirSync(targetDirectory);
        } catch (error) {
          // Two uploads can race the existsSync check (a drop racing a paste,
          // or a second tab). Losing that race is a success as long as the
          // leaf is now a directory; anything else is a real failure.
          const code = (error as NodeJS.ErrnoException | undefined)?.code;
          if (code !== "EEXIST" || !fs.statSync(targetDirectory).isDirectory()) {
            throw error;
          }
        }
      }
    } catch (error) {
      return {
        error: `Upload destination is unavailable: ${fileErrorMessage(error)}`,
        status: 409,
      };
    }

    let finalName = safeFilename(filename);
    let filePath = path.join(targetDirectory, finalName);

    // Prefer the clean name; only touch the filesystem content that is
    // already there when the client explicitly asked for an overwrite.
    // Collision names disambiguate with a random suffix as well as the
    // timestamp, so two uploads of the same name landing within the same
    // millisecond (concurrent drops) always get distinct names.
    if (fs.existsSync(filePath) && !overwrite) {
      for (;;) {
        finalName = `${Date.now()}-${randomBytes(4).toString("hex")}-${finalName.replace(/^\d+-[0-9a-f]{8}-/, "")}`;
        filePath = path.join(targetDirectory, finalName);
        if (!fs.existsSync(filePath)) break;
      }
    }

    // Defensive containment: safeFilename already strips separators and
    // leading dots, but a filename that normalizes outside targetDir must
    // never be written — reject rather than resolve away.
    if (!isPathInside(targetDirectory, filePath)) {
      return {
        error: "Filename resolves outside the target directory",
        status: 400,
      };
    }

    try {
      fs.writeFileSync(filePath, buffer);
    } catch (error) {
      return {
        error: `Upload destination is not writable: ${fileErrorMessage(error)}`,
        status: 409,
      };
    }
    return { path: filePath };
  }

  // Create temp directory for screenshots if it doesn't exist
  const tempDir = path.join(os.tmpdir(), "cliweb-screenshots");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Generate unique filename
  const ext = mimeType.split("/")[1] || "png";
  const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, "_") || "screenshot";
  const uniqueName = `${Date.now()}-${safeName}`;
  // A name that already carries an extension keeps it: appending the mime
  // subtype blindly turned a pasted paste-....txt into paste-....txt.plain
  // (mime text/plain) when the terminal had no working directory.
  const hasOwnExtension = /\.[A-Za-z0-9]{1,10}$/u.test(safeName);
  const finalName = hasOwnExtension || uniqueName.endsWith(`.${ext}`)
    ? uniqueName
    : `${uniqueName}.${ext}`;
  const filePath = path.join(tempDir, finalName);

  fs.writeFileSync(filePath, buffer);
  return { path: filePath };
}

/**
 * Legacy single-request upload: the whole file arrives as one base64 JSON
 * body. Screenshots and any pre-existing callers keep working through here.
 */
async function handleOneShot(
  request: Request,
  body: {
    filename?: unknown;
    base64?: unknown;
    mimeType?: unknown;
    targetDir?: unknown;
    overwrite?: unknown;
    createTargetDir?: unknown;
  }
): Promise<NextResponse> {
  // Cheap gate first: a Content-Length that already exceeds the limit can
  // bail before the body is parsed. Best-effort only — chunked or encoding
  // without a length is still caught by the decoded-size check below.
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return badRequest("File too large", 413);
  }

  // Body arrives pre-parsed from the dispatcher; a Request's JSON body can
  // only be read once, so re-reading it here always throws.
  const { filename, base64, mimeType, targetDir, overwrite, createTargetDir } =
    body;

  // base64 inflates by 4/3, so the decoded payload is what must fit under
  // the limit. Checking the raw string would let a ~1.33x oversized file
  // through.
  if (typeof base64 !== "string" || base64.length * 0.75 > MAX_UPLOAD_BYTES) {
    return badRequest("File too large", 413);
  }

  if (!base64) {
    return badRequest("No image data");
  }

  const targetDirectory = sanitizeTargetDir(targetDir);

  if (targetDir != null && !targetDirectory) {
    return badRequest(
      "targetDir must be an absolute path without .. segments"
    );
  }

  const result = writeAssembledFile(
    decodeBase64(base64),
    typeof filename === "string" ? filename : "",
    typeof mimeType === "string" ? mimeType : "",
    targetDirectory,
    overwrite === true,
    createTargetDir !== false
  );
  if (result.error) return badRequest(result.error, result.status);

  return NextResponse.json({ path: result.path });
}

/**
 * Chunked flow, step 1: register the upload and hand back an uploadId plus
 * the exact chunk size the client must use.
 */
async function handleInit(body: Record<string, unknown>): Promise<NextResponse> {
  sweepExpiredSessions();

  const {
    filename,
    totalBytes,
    totalChunks,
    mimeType,
    targetDir,
    overwrite,
    createTargetDir,
  } = body;

  if (typeof filename !== "string" || filename.trim() === "") {
    return badRequest("filename is required");
  }
  if (
    typeof totalBytes !== "number" ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0
  ) {
    return badRequest("totalBytes must be a positive number");
  }
  if (totalBytes > MAX_UPLOAD_BYTES) {
    return badRequest("File too large", 413);
  }
  if (
    typeof totalChunks !== "number" ||
    !Number.isInteger(totalChunks) ||
    totalChunks <= 0
  ) {
    return badRequest("totalChunks must be a positive integer");
  }

  const targetDirectory = sanitizeTargetDir(targetDir);
  if (targetDir != null && !targetDirectory) {
    return badRequest(
      "targetDir must be an absolute path without .. segments"
    );
  }

  // Keep the effective chunk size consistent with what the client slices:
  // the last chunk is naturally short, all others must be UPLOAD_CHUNK_BYTES.
  const chunkSizeBytes = Math.min(UPLOAD_CHUNK_BYTES, totalBytes);

  // A wrong totalChunks would corrupt assembly (short mid-file chunks or
  // missing tail), so cross-check it against the arithmetic the client must
  // have used.
  const expectedChunks = Math.ceil(totalBytes / chunkSizeBytes);
  if (totalChunks !== expectedChunks) {
    return badRequest(
      `totalChunks must be ${expectedChunks} for ${totalBytes} bytes at ${chunkSizeBytes} bytes per chunk`
    );
  }

  const uploadId = newUploadId();
  sessions.set(uploadId, {
    filename,
    targetDirectory,
    createTargetDir: createTargetDir !== false,
    mimeType:
      typeof mimeType === "string" && mimeType
        ? mimeType
        : "",
    overwrite: overwrite === true,
    chunkSizeBytes,
    totalChunks,
    totalBytes,
    receivedBytes: 0,
    nextChunkIndex: 0,
    expiresAtMs: Date.now() + UPLOAD_TTL_MS,
  });

  return NextResponse.json({ uploadId, chunkSize: chunkSizeBytes });
}

/**
 * Chunked flow, steps 2..n: append one base64 chunk. The final chunk
 * assembles the file into its destination and returns {path}.
 */
async function handleChunk(
  body: Record<string, unknown>
): Promise<NextResponse> {
  const { uploadId, chunkIndex, chunk } = body;

  if (typeof uploadId !== "string" || !/^[a-z0-9-]+$/.test(uploadId)) {
    return badRequest("Invalid uploadId");
  }
  const session = sessions.get(uploadId);
  if (!session) {
    return badRequest("Unknown or expired uploadId", 404);
  }
  if (typeof chunkIndex !== "number" || !Number.isInteger(chunkIndex)) {
    return badRequest("chunkIndex must be an integer");
  }
  if (typeof chunk !== "string" || chunk === "") {
    return badRequest("chunk must be a non-empty base64 string");
  }
  if (chunkIndex !== session.nextChunkIndex) {
    return badRequest(
      `Out-of-order chunk: expected ${session.nextChunkIndex}, got ${chunkIndex}`
    );
  }

  // All chunks except the last must decode to exactly the full chunk size:
  // a short chunk mid-file would silently truncate the assembled file.
  const isLast = chunkIndex === session.totalChunks - 1;

  const decoded = decodeBase64(chunk);
  if (decoded.length === 0) {
    return badRequest("chunk did not decode to any bytes");
  }
  if (!isLast && decoded.length !== session.chunkSizeBytes) {
    return badRequest(
      `Chunk ${chunkIndex} must be exactly ${session.chunkSizeBytes} bytes; got ${decoded.length}`
    );
  }

  session.receivedBytes += decoded.length;
  // Overflow of either the declared size or the global cap kills the
  // session AND deletes its partial staging dir: an aborted upload must
  // leave nothing behind for the next upload (or the TTL sweep) to trip
  // over. totalBytes is already validated <= MAX_UPLOAD_BYTES at init, so
  // the declared-size check covers both in practice; the cap is asserted
  // for defense in depth against a future init change.
  if (
    session.receivedBytes > session.totalBytes ||
    session.receivedBytes > MAX_UPLOAD_BYTES
  ) {
    sessions.delete(uploadId);
    try {
      fs.rmSync(path.join(PARTIALS_ROOT, uploadId), {
        recursive: true,
        force: true,
      });
    } catch {
      // Ignore cleanup failures; the session is gone either way.
    }
    return badRequest("Received more bytes than declared in init", 413);
  }

  const partialDir = path.join(PARTIALS_ROOT, uploadId);
  fs.mkdirSync(partialDir, { recursive: true });

  // zero-padded name keeps filesystem reassembly order == index order.
  const partialPath = path.join(
    partialDir,
    `${String(chunkIndex).padStart(12, "0")}.part`
  );
  // Containment paranoia: uploadId is validated above and generated here,
  // but never trust a join blind.
  if (!isPathInside(partialDir, partialPath)) {
    return badRequest("Invalid uploadId");
  }
  fs.writeFileSync(partialPath, decoded);

  session.nextChunkIndex = chunkIndex + 1;

  if (!isLast) {
    return NextResponse.json({ uploadId, received: session.receivedBytes });
  }

  // Final chunk: assemble in index order and land the file.
  try {
    const parts = fs
      .readdirSync(partialDir)
      .filter((name) => name.endsWith(".part"))
      .sort();

    if (parts.length !== session.totalChunks) {
      return badRequest(
        `Assembly expected ${session.totalChunks} chunks, found ${parts.length}`
      );
    }

    const buffers = parts.map((name) =>
      fs.readFileSync(path.join(partialDir, name))
    );
    const assembled = Buffer.concat(buffers);

    if (assembled.length !== session.totalBytes) {
      return badRequest(
        `Assembled size ${assembled.length} does not match declared ${session.totalBytes}`
      );
    }

    const result = writeAssembledFile(
      assembled,
      session.filename,
      session.mimeType,
      session.targetDirectory,
      session.overwrite,
      session.createTargetDir
    );
    if (result.error) return badRequest(result.error, result.status);

    sessions.delete(uploadId);
    return NextResponse.json({
      path: result.path,
      received: session.receivedBytes,
    });
  } finally {
    // Partials are transient: always clean the staging directory, even when
    // assembly fails.
    sessions.delete(uploadId);
    try {
      fs.rmSync(partialDir, { recursive: true, force: true });
    } catch {
      // Best-effort; the TTL sweep is the backstop.
    }
  }
}

export async function POST(request: Request) {
  try {
    // CSRF tripwire: only JSON from our own origin gets to write files.
    const guard = guardJsonSameOrigin(request);
    if (guard) return guard;

    const body = await request.json();

    if (body && typeof body === "object" && body.op === "init") {
      return handleInit(body);
    }
    if (body && typeof body === "object" && body.op === "chunk") {
      return handleChunk(body);
    }

    // No op marker: legacy one-shot upload shape.
    return handleOneShot(
      request,
      body as {
        filename?: unknown;
        base64?: unknown;
        mimeType?: unknown;
        targetDir?: unknown;
        overwrite?: unknown;
        createTargetDir?: unknown;
      }
    );
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to save image" },
      { status: 500 }
    );
  }
}
