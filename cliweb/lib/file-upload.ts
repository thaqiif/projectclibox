import { toast } from "sonner";
import { MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from "@/lib/upload-limits";

interface UploadOptions {
  /** Absolute directory to land the file in (e.g. the terminal cwd). */
  targetDir?: string | null;
  /** Replace an existing file of the same name instead of timestamping. */
  overwrite?: boolean;
}

interface UploadWithProgressOptions extends UploadOptions {
  /**
   * Progress callback. Fires after every accepted chunk with the aggregate
   * bytes the server has confirmed so far and the total file size, so
   * callers can render an accurate percentage.
   */
  onProgress?: (bytesSent: number, totalBytes: number) => void;
}

/** Format a byte count for size-limit messages (e.g. "200.0 MB"). */
function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Encode bytes as base64 in fixed-size slices.
 *
 * Building the binary string from one big Uint8Array a byte at a time with
 * `data + String.fromCharCode(byte)` is O(n^2): every byte re-copies the
 * whole string so far. Slicing the view into fixed chunks and feeding each
 * chunk to String.fromCharCode makes it linear. A full-file btoa on a
 * 200MB file would also build a ~267MB binary string; the chunks keep the
 * peak allocation the same but the build loop linear.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // < the argument-count limit for string building
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.slice(i, i + CHUNK)));
  }
  return btoa(parts.join(""));
}

/** Non-2xx with a JSON error body: surface the server's message. */
function serverError(data: { error?: string }): Error {
  return new Error(data.error || "Upload failed");
}

/**
 * Upload a file in chunks with progress reporting.
 *
 * Protocol (see app/api/files/upload-temp/route.ts):
 * 1. POST {op:"init", filename, totalBytes, totalChunks, ...} -> {uploadId}
 * 2. POST {op:"chunk", uploadId, chunkIndex, chunk} per 512KB base64
 *    slice; the server confirms each with {received} and assembles the
 *    final file when the last chunk lands.
 *
 * Every chunk POST includes the real Content-Length, so the browser fires
 * incremental load events and `onProgress` reports aggregate confirmed
 * bytes (server-acked, not just handed to the network) after each chunk.
 * The final callback fires at 100% once assembly succeeds.
 *
 * Errors are toasted here (matching the old behavior) and also thrown so
 * programmatic callers can react.
 */
export async function uploadFileWithProgress(
  file: File,
  options: UploadWithProgressOptions = {}
): Promise<string> {
  const { onProgress } = options;
  const totalBytes = file.size;
  const chunkSize = Math.min(UPLOAD_CHUNK_BYTES, totalBytes);
  const totalChunks = Math.max(1, Math.ceil(totalBytes / chunkSize));

  const report = (sent: number) => onProgress?.(sent, totalBytes);

  // 1. Register the upload and get its id.
  const initRes = await fetch("/api/files/upload-temp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      op: "init",
      filename: file.name || `file-${Date.now()}`,
      totalBytes,
      totalChunks,
      mimeType: file.type || "",
      targetDir: options.targetDir ?? undefined,
      overwrite: options.overwrite,
    }),
  });

  const initData = await initRes.json();
  if (!initRes.ok) throw serverError(initData);
  const uploadId: string = initData.uploadId;
  if (typeof uploadId !== "string" || !uploadId) {
    throw new Error("Upload failed: no uploadId returned");
  }

  // 2. Stream the file in sequential chunks; the last chunk's response
  // carries the assembled file's path.
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const isLast = chunkIndex === totalChunks - 1;
    const slice = file.slice(
      chunkIndex * chunkSize,
      Math.min((chunkIndex + 1) * chunkSize, totalBytes)
    );
    const bytes = new Uint8Array(await slice.arrayBuffer());
    const chunk = toBase64(bytes);

    const chunkRes = await fetch("/api/files/upload-temp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        op: "chunk",
        uploadId,
        chunkIndex,
        chunk,
      }),
    });

    const chunkData = await chunkRes.json();
    if (!chunkRes.ok) throw serverError(chunkData);

    if (isLast) {
      if (!chunkData.path) {
        throw new Error("Upload failed: server did not return a path");
      }
      report(totalBytes);
      return chunkData.path as string;
    }

    // Trust the server's ack, not our local arithmetic.
    report(
      typeof chunkData.received === "number"
        ? chunkData.received
        : (chunkIndex + 1) * chunkSize
    );
  }

  throw new Error("Upload failed: no chunks sent");
}

/**
 * Upload a file and return its path.
 * Slices the file into 512KB chunks and POSTs them sequentially to
 * /api/files/upload-temp, reporting progress to the module-level
 * upload-progress pub/sub (see hooks/useFileUploadProgress.ts) so any UI
 * can subscribe without prop drilling.
 *
 * Without options, the file lands in /tmp (screenshots and legacy callers).
 * With `targetDir`, the file is written into that directory, using the
 * original filename plus a timestamp prefix only to avoid a collision.
 *
 * Files larger than MAX_UPLOAD_BYTES are rejected here with a non-blocking
 * toast (the server enforces the same limit with a 413).
 *
 * @param file - The file to upload
 * @returns The path to the uploaded file, or null if upload failed
 */
export async function uploadFileToTemp(
  file: File,
  options: UploadOptions = {}
): Promise<string | null> {
  if (file.size > MAX_UPLOAD_BYTES) {
    toast.error(
      `"${file.name}" is ${formatBytes(file.size)}, over the ${formatBytes(
        MAX_UPLOAD_BYTES
      )} upload limit`
    );
    return null;
  }

  try {
    const uploadedPath = await uploadFileWithProgress(file, {
      ...options,
      onProgress: (bytesSent, totalBytes) =>
        setUploadProgress(file.name, bytesSent, totalBytes),
    });
    return uploadedPath;
  } catch (error) {
    console.error("Upload failed:", error);
    toast.error(
      `Upload failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
    return null;
  } finally {
    // Clear the pub/sub either way so progress UI hides when done.
    setUploadProgress(null);
  }
}

// --- Module-level progress pub/sub (consumed by the UI) ---

export interface UploadProgress {
  /** Name of the file being uploaded. */
  filename: string;
  /** Bytes the server has confirmed so far. */
  bytesSent: number;
  /** Total file size in bytes. */
  totalBytes: number;
}

type ProgressListener = (progress: UploadProgress | null) => void;

const progressListeners = new Set<ProgressListener>();

/**
 * Publish an aggregate progress update to all subscribers. Passing null
 * signals the upload finished (or failed) and any progress UI should hide.
 *
 * Called internally by uploadFileToTemp; export kept for callers that use
 * uploadFileWithProgress directly and want the same broadcast.
 */
export function setUploadProgress(
  filename: string,
  bytesSent: number,
  totalBytes: number
): void;
export function setUploadProgress(progress: null): void;
export function setUploadProgress(
  filenameOrProgress: string | null,
  bytesSent?: number,
  totalBytes?: number
): void {
  const progress =
    filenameOrProgress === null
      ? null
      : {
          filename: filenameOrProgress,
          bytesSent: bytesSent ?? 0,
          totalBytes: totalBytes ?? 0,
        };
  for (const listener of progressListeners) {
    listener(progress);
  }
}

/**
 * Subscribe to aggregate upload progress. Returns an unsubscribe function.
 * See hooks/useFileUploadProgress.ts for the React-friendly wrapper.
 */
export function onUploadProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}
