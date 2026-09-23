/**
 * Shared, configurable upload size limit.
 *
 * Lives in its own module so the client-side pre-flight check and the
 * server-side 413 check can never drift apart: import the same constant
 * from both sides.
 *
 * Static JSON uploads are hard-capped at 200MB (configurable here) because
 * Next.js buffers the whole body before the route runs.
 */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
