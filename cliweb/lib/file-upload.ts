import { toast } from "sonner";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";

interface UploadOptions {
  /** Absolute directory to land the file in (e.g. the terminal cwd). */
  targetDir?: string | null;
  /** Replace an existing file of the same name instead of timestamping. */
  overwrite?: boolean;
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

/**
 * Upload a file and return its path.
 * Converts the file to base64 and POSTs to /api/files/upload-temp.
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

  const buffer = await file.arrayBuffer();
  const base64 = toBase64(new Uint8Array(buffer));

  const res = await fetch("/api/files/upload-temp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name || `file-${Date.now()}`,
      base64,
      mimeType: file.type || "application/octet-stream",
      targetDir: options.targetDir ?? undefined,
      overwrite: options.overwrite,
    }),
  });

  const data = await res.json();
  if (data.path) {
    return data.path;
  }

  console.error("Upload failed:", data.error);
  return null;
}
