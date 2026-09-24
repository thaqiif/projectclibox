/**
 * Shared, configurable upload size limits.
 *
 * Lives in its own module so the client-side pre-flight check and the
 * server-side 413 check can never drift apart: import the same constants
 * from both sides.
 */

/**
 * Static JSON uploads are hard-capped at 200MB (configurable here) because
 * Next.js buffers the whole body before the route runs.
 */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * Chunk size for the chunked upload protocol.
 *
 * Both sides must agree: the server validates that every chunk except the
 * last decodes to exactly this many bytes, and the client slices the file
 * with it. 512KB keeps each JSON request (and its base64 body, ~700KB)
 * comfortably small while capping per-request memory.
 */
export const UPLOAD_CHUNK_BYTES = 512 * 1024;
