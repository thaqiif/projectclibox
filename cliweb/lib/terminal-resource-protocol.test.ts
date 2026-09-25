import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeTerminalResourceFrame,
  encodeTerminalResourceFrame,
  TERMINAL_RESOURCE_MAX_FRAME_BYTES,
  TERMINAL_RESOURCE_MAX_HEADER_BYTES,
} from "./terminal-resource-protocol";

test("resource frames encode a big-endian header length and payload", () => {
  const payload = new Uint8Array([1, 2, 3]);
  const encoded = encodeTerminalResourceFrame(
    { version: 1, type: "chunk", id: 9, offset: 0 },
    payload
  );
  const decoded = decodeTerminalResourceFrame(encoded);

  assert.deepEqual(decoded.header, {
    version: 1,
    type: "chunk",
    id: 9,
    offset: 0,
  });
  assert.deepEqual([...decoded.bytes], [1, 2, 3]);
  assert.equal(
    new DataView(encoded.buffer).getUint32(0, false),
    new TextEncoder().encode(JSON.stringify(decoded.header)).byteLength
  );
});

test("resource frames reject malformed, truncated, and oversized headers", () => {
  assert.throws(() => decodeTerminalResourceFrame(new Uint8Array([0, 0, 0])));
  assert.throws(() =>
    decodeTerminalResourceFrame(new Uint8Array([0, 0, 0, 8, 1]))
  );
  const invalidJson = new Uint8Array([0, 0, 0, 1, 0xff]);
  assert.throws(() => decodeTerminalResourceFrame(invalidJson));

  const oversizedHeader = new Uint8Array(4);
  new DataView(oversizedHeader.buffer).setUint32(
    0,
    TERMINAL_RESOURCE_MAX_HEADER_BYTES + 1,
    false
  );
  assert.throws(() => decodeTerminalResourceFrame(oversizedHeader));
  assert.throws(() =>
    encodeTerminalResourceFrame(
      { type: "chunk" },
      new Uint8Array(TERMINAL_RESOURCE_MAX_FRAME_BYTES + 1)
    )
  );
});
