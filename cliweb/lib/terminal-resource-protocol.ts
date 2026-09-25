export const TERMINAL_RESOURCE_PROTOCOL_VERSION = 1 as const;
export const TERMINAL_RESOURCE_MAX_HEADER_BYTES = 4 * 1024;
export const TERMINAL_RESOURCE_MAX_FRAME_BYTES = 256 * 1024;
export const TERMINAL_RESOURCE_MAX_BYTES = 32 * 1024 * 1024;

export interface TerminalResourceFrame {
  header: Record<string, unknown>;
  bytes: Uint8Array;
}

export function encodeTerminalResourceFrame(
  header: Record<string, unknown>,
  bytes: Uint8Array<ArrayBufferLike> = new Uint8Array()
): Uint8Array {
  const encodedHeader = new TextEncoder().encode(JSON.stringify(header));
  if (
    encodedHeader.byteLength === 0 ||
    encodedHeader.byteLength > TERMINAL_RESOURCE_MAX_HEADER_BYTES ||
    bytes.byteLength > TERMINAL_RESOURCE_MAX_FRAME_BYTES
  ) {
    throw new Error("Terminal resource frame exceeds its size limit");
  }

  const frame = new Uint8Array(4 + encodedHeader.byteLength + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, encodedHeader.byteLength, false);
  frame.set(encodedHeader, 4);
  frame.set(bytes, 4 + encodedHeader.byteLength);
  return frame;
}

export function decodeTerminalResourceFrame(
  input: ArrayBuffer | ArrayBufferView
): TerminalResourceFrame {
  const frame =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (frame.byteLength < 4)
    throw new Error("Terminal resource frame is truncated");

  const headerLength = new DataView(
    frame.buffer,
    frame.byteOffset,
    frame.byteLength
  ).getUint32(0, false);
  if (
    headerLength === 0 ||
    headerLength > TERMINAL_RESOURCE_MAX_HEADER_BYTES ||
    4 + headerLength > frame.byteLength
  ) {
    throw new Error("Terminal resource frame has an invalid header length");
  }
  const bytes = frame.subarray(4 + headerLength);
  if (bytes.byteLength > TERMINAL_RESOURCE_MAX_FRAME_BYTES) {
    throw new Error("Terminal resource frame payload exceeds its size limit");
  }

  let header: unknown;
  try {
    header = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        frame.subarray(4, 4 + headerLength)
      )
    );
  } catch {
    throw new Error("Terminal resource frame has malformed JSON");
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) {
    throw new Error("Terminal resource frame header must be an object");
  }

  return { header: header as Record<string, unknown>, bytes };
}
