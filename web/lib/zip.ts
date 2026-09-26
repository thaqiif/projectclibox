/**
 * Minimal ZIP container writer (STORE mode only) - server-only.
 *
 * Builds an in-memory zip archive from a directory tree with no external
 * dependencies. Entries are stored uncompressed (method 0/STORE): for
 * "download this folder as a zip" the simplicity and zero-dependency cost
 * outweigh compression, and already-compressed assets dominate most
 * workspaces anyway. Deflate (method 8) is deliberately NOT implemented;
 * comment here marks the only place a compression backend would plug in.
 *
 * Structure emitted (all little-endian, per APPNOTE.TXT):
 *   [local file header + data] x N
 *   [central directory header] x N
 *   [end of central directory record]
 *
 * Bounds: recursion depth-capped and total-size-capped; symlinks skipped.
 * Excludes build/VCS noise directories (node_modules, .git, ...).
 */

import { lstatSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

/** Hardcoded exclusion list (names skipped at any depth). */
const EXCLUDED_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".vercel",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
]);

/** Maximum directory recursion depth below the root. */
const MAX_DEPTH = 20;

/** Maximum total uncompressed bytes accepted into the archive. */
export const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

/** Thrown when a limit (total size, depth) is hit mid-walk. */
export class ZipLimitError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ZipLimitError";
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3, polynomial 0xEDB88320), table-driven.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Byte helpers (little-endian writers into a growable buffer).
// ---------------------------------------------------------------------------

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    const b = new Uint8Array(2);
    b[0] = value & 0xff;
    b[1] = (value >>> 8) & 0xff;
    this.push(b);
  }

  u32(value: number): void {
    const b = new Uint8Array(4);
    b[0] = value & 0xff;
    b[1] = (value >>> 8) & 0xff;
    b[2] = (value >>> 16) & 0xff;
    b[3] = (value >>> 24) & 0xff;
    this.push(b);
  }

  raw(bytes: Uint8Array): void {
    this.push(bytes);
  }

  get byteLength(): number {
    return this.length;
  }

  /** Concatenate all chunks into one buffer (called once, at the end). */
  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** DOS date/time (local time of the server), valid 1980-2107. */
function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (Math.floor(date.getSeconds() / 2) & 0x1f);
  return { date: dosDate & 0xffff, time: dosTime & 0xffff };
}

// ---------------------------------------------------------------------------
// Walk + archive
// ---------------------------------------------------------------------------

interface CollectedEntry {
  /** Archive path, always "/"-separated, no leading slash. */
  zipPath: string;
  isDirectory: boolean;
  data: Uint8Array | null;
  crc: number;
  mtime: Date;
}

function collect(
  rootDir: string,
  absDir: string,
  depth: number,
  entries: CollectedEntry[],
  state: { totalBytes: number }
): void {
  if (depth > MAX_DEPTH) {
    throw new ZipLimitError(
      `Directory tree exceeds maximum depth of ${MAX_DEPTH}`,
      413
    );
  }

  let names: string[];
  try {
    names = readdirSync(absDir);
  } catch {
    // Unreadable directory: skip it rather than failing the whole archive.
    return;
  }
  names.sort();

  for (const name of names) {
    if (EXCLUDED_NAMES.has(name)) continue;

    const absPath = join(absDir, name);
    let lstat;
    try {
      // lstat: symlinks are skipped entirely (never followed).
      lstat = lstatSync(absPath, { throwIfNoEntry: false });
      if (!lstat) continue;
      if (lstat.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    const stat = statSync(absPath, { throwIfNoEntry: false });
    if (!stat) continue;

    // Archive path is always relative to the zip root, "/"-separated.
    const zipPath = relative(rootDir, absPath).split(sep).join("/");
    if (zipPath.startsWith("..")) continue; // paranoia; cannot happen with join/relative

    if (stat.isDirectory()) {
      entries.push({
        zipPath: `${zipPath}/`,
        isDirectory: true,
        data: null,
        crc: 0,
        mtime: stat.mtime,
      });
      collect(rootDir, absPath, depth + 1, entries, state);
    } else if (stat.isFile()) {
      if (state.totalBytes + stat.size > MAX_TOTAL_BYTES) {
        throw new ZipLimitError(
          `Directory exceeds maximum archive size of ${(
            MAX_TOTAL_BYTES /
            (1024 * 1024)
          ).toFixed(0)}MB`,
          413
        );
      }
      let data: Uint8Array;
      try {
        data = readFileSync(absPath);
      } catch {
        continue; // unreadable file: skip
      }
      state.totalBytes += data.length;
      entries.push({
        zipPath,
        isDirectory: false,
        data,
        crc: crc32(data),
        mtime: stat.mtime,
      });
    }
    // Anything else (sockets, fifos, devices): skip.
  }
}

interface ZipEntryMeta {
  nameBytes: Uint8Array;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  mtime: Date;
  isDirectory: boolean;
}

/**
 * Build a STORE-mode zip archive of `dirPath` (a directory) and return the
 * full archive as a Uint8Array. Throws ZipLimitError when the size or depth
 * cap is exceeded.
 */
export function buildZipFromDirectory(dirPath: string): Uint8Array {
  const rootStat = statSync(dirPath);
  if (!rootStat.isDirectory()) {
    throw new Error("Not a directory");
  }

  const collected: CollectedEntry[] = [];
  const state = { totalBytes: 0 };
  collect(dirPath, dirPath, 0, collected, state);

  const writer = new ByteWriter();
  const metas: ZipEntryMeta[] = [];

  for (const entry of collected) {
    const nameBytes = utf8Bytes(entry.zipPath);
    const { date, time } = dosDateTime(entry.mtime);
    const size = entry.isDirectory ? 0 : entry.data!.length;
    const offset = writer.byteLength;

    // Local file header
    writer.u32(0x04034b50); // signature
    writer.u16(20); // version needed: 2.0 (directories + store)
    writer.u16(0x0800); // flags: UTF-8 name
    writer.u16(0); // method: STORE (no deflate implemented)
    writer.u16(time);
    writer.u16(date);
    writer.u32(entry.crc);
    writer.u32(size); // compressed size (== uncompressed for STORE)
    writer.u32(size); // uncompressed size
    writer.u16(nameBytes.length);
    writer.u16(0); // extra field length
    writer.raw(nameBytes);
    if (!entry.isDirectory) {
      writer.raw(entry.data!);
    }

    metas.push({
      nameBytes,
      crc: entry.crc,
      compressedSize: size,
      uncompressedSize: size,
      offset,
      mtime: entry.mtime,
      isDirectory: entry.isDirectory,
    });
  }

  const centralStart = writer.byteLength;
  for (const meta of metas) {
    const { date, time } = dosDateTime(meta.mtime);
    // External attrs: 0o755 << 16 for dirs, 0o644 << 16 for files (unix).
    const externalAttrs = (meta.isDirectory ? 0o755 : 0o644) << 16;

    writer.u32(0x02014b50); // signature
    writer.u16(20); // version made by (2.0, no platform bits = FAT/MS-DOS compatible)
    writer.u16(20); // version needed
    writer.u16(0x0800); // flags: UTF-8 name
    writer.u16(0); // method: STORE
    writer.u16(time);
    writer.u16(date);
    writer.u32(meta.crc);
    writer.u32(meta.compressedSize);
    writer.u32(meta.uncompressedSize);
    writer.u16(meta.nameBytes.length);
    writer.u16(0); // extra length
    writer.u16(0); // comment length
    writer.u16(0); // disk number start
    writer.u16(0); // internal attrs
    writer.u32(externalAttrs);
    writer.u32(meta.offset);
    writer.raw(meta.nameBytes);
  }
  const centralSize = writer.byteLength - centralStart;

  // End of central directory record
  writer.u32(0x06054b50); // signature
  writer.u16(0); // disk number
  writer.u16(0); // central directory disk
  writer.u16(metas.length); // entries on this disk
  writer.u16(metas.length); // total entries
  writer.u32(centralSize);
  writer.u32(centralStart);
  writer.u16(0); // comment length

  return writer.concat();
}
