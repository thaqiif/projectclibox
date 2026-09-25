import { spawn } from "node:child_process";
import { lookup as dnsLookup } from "node:dns/promises";
import { constants } from "node:fs";
import { Readable } from "node:stream";
import { BlockList, isIP } from "node:net";
import { posix } from "node:path";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet, type RequestOptions } from "node:https";
import type { TerminalCapability } from "./terminal-capabilities";
import {
  TERMINAL_RESOURCE_MAX_BYTES,
  TERMINAL_RESOURCE_MAX_FRAME_BYTES,
  TERMINAL_RESOURCE_PROTOCOL_VERSION,
} from "./terminal-resource-protocol";

const RESOURCE_SOURCE_MAX_BYTES = 4096;
const RESOURCE_TIMEOUT_MS = 5_000;
const RESOURCE_REDIRECT_LIMIT = 3;
const RESOURCE_READ_CHUNK_BYTES = 256 * 1024;

export interface TerminalResourceRequest {
  id: number;
  transport: "file" | "temporary-file" | "url";
  source: string;
  offset: number;
  length: number;
  width: number;
  height: number;
  format: 24 | 32 | 100;
}

interface ResourceSource {
  chunks: AsyncIterable<Uint8Array> | (() => AsyncIterable<Uint8Array>);
  finish(success: boolean): Promise<void>;
  abort(): void;
}

export type SendTerminalResourceFrame = (
  header: Record<string, unknown>,
  bytes?: Uint8Array
) => Promise<void>;

export function parseTerminalResourceRequest(
  value: Record<string, unknown>
): TerminalResourceRequest {
  const { id, transport, source, offset, length, width, height, format } =
    value;
  if (
    value.version !== TERMINAL_RESOURCE_PROTOCOL_VERSION ||
    value.type !== "request" ||
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    (transport !== "file" &&
      transport !== "temporary-file" &&
      transport !== "url") ||
    typeof source !== "string" ||
    source.length === 0 ||
    Buffer.byteLength(source, "utf8") > RESOURCE_SOURCE_MAX_BYTES ||
    source.includes("\0") ||
    typeof offset !== "number" ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 0xffffffff ||
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > TERMINAL_RESOURCE_MAX_BYTES ||
    typeof width !== "number" ||
    !Number.isSafeInteger(width) ||
    width < 0 ||
    width > 10_000 ||
    typeof height !== "number" ||
    !Number.isSafeInteger(height) ||
    height < 0 ||
    height > 10_000 ||
    (format !== 24 && format !== 32 && format !== 100)
  ) {
    throw new Error("Invalid terminal resource request");
  }
  return { id, transport, source, offset, length, width, height, format };
}

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

function mappedIpv4FromIpv6(address: string): string | null {
  const normalized = address.toLowerCase();
  const dotted = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u);
  if (dotted && isIP(dotted[1]!) === 4) return dotted[1]!;

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const groups = (halves[0] ? halves[0]!.split(":") : []).concat(
    halves.length === 2 && halves[1] ? halves[1]!.split(":") : []
  );
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))
  ) {
    if (halves.length !== 2) return null;
    const left = halves[0] ? halves[0]!.split(":") : [];
    const right = halves[1] ? halves[1]!.split(":") : [];
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups.splice(
      0,
      groups.length,
      ...left,
      ...Array(missing).fill("0"),
      ...right
    );
  }
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))
  ) {
    return null;
  }
  const value = groups.reduce(
    (result, group) => (result << BigInt(16)) | BigInt(`0x${group}`),
    BigInt(0)
  );
  if (value >> BigInt(32) !== BigInt(0xffff)) return null;
  const ipv4 = Number(value & BigInt(0xffffffff));
  return [24, 16, 8, 0].map((shift) => (ipv4 >> shift) & 0xff).join(".");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  if (family === 4) return !blockedIpv4Addresses.check(address, "ipv4");
  const mappedIpv4 = mappedIpv4FromIpv6(address);
  return mappedIpv4
    ? !blockedIpv4Addresses.check(mappedIpv4, "ipv4")
    : !blockedIpv6Addresses.check(address, "ipv6");
}

export function waitForAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new Error("Terminal resource request cancelled"));
  }

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reject(new Error("Terminal resource request cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

async function resolvePublicAddress(
  hostname: string,
  signal: AbortSignal
): Promise<{
  address: string;
  family: 4 | 6;
}> {
  const hostnameWithoutBrackets = hostname.replace(/^\[|\]$/gu, "");
  const literalFamily = isIP(hostnameWithoutBrackets);
  const addresses = literalFamily
    ? [{ address: hostnameWithoutBrackets, family: literalFamily as 4 | 6 }]
    : await waitForAbort(
        dnsLookup(hostnameWithoutBrackets, { all: true, verbatim: true }),
        signal
      );
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new Error("URL host resolves to a private or reserved address");
  }
  const selected = addresses[0]!;
  return { address: selected.address, family: selected.family as 4 | 6 };
}

function validateUrl(input: URL): void {
  if (
    (input.protocol !== "https:" && input.protocol !== "http:") ||
    input.username !== "" ||
    input.password !== "" ||
    (input.port !== "" &&
      input.port !== (input.protocol === "https:" ? "443" : "80"))
  ) {
    throw new Error(
      "URL transport only permits credential-free HTTP(S) on ports 80 and 443"
    );
  }
}

function requestUrlOnce(
  url: URL,
  address: { address: string; family: 4 | 6 },
  signal: AbortSignal
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const requestOptions: RequestOptions = {
      headers: {
        Accept: "image/png",
        "Accept-Encoding": "identity",
        "User-Agent": "CLIWeb-WTerm/1",
      },
      lookup: (_hostname, _options, callback) =>
        callback(null, address.address, address.family),
    };
    const request = (url.protocol === "https:" ? httpsGet : httpGet)(
      url,
      requestOptions,
      resolve
    );
    const timeout = setTimeout(
      () => request.destroy(new Error("URL resource request timed out")),
      RESOURCE_TIMEOUT_MS
    );
    const abort = () =>
      request.destroy(new Error("URL resource request cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    request.once("error", (error) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    request.once("close", () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    });
  });
}

async function openPngUrl(
  url: URL,
  signal: AbortSignal,
  redirects = 0
): Promise<Readable> {
  validateUrl(url);
  if (signal.aborted) throw new Error("URL resource request cancelled");
  const address = await resolvePublicAddress(url.hostname, signal);
  if (signal.aborted) throw new Error("URL resource request cancelled");
  const response = await requestUrlOnce(url, address, signal);
  const status = response.statusCode ?? 0;
  if (status >= 300 && status < 400) {
    const location = response.headers.location;
    response.destroy();
    if (!location || redirects >= RESOURCE_REDIRECT_LIMIT) {
      throw new Error("URL resource redirect limit exceeded");
    }
    const nextUrl = new URL(location, url);
    validateUrl(nextUrl);
    return openPngUrl(nextUrl, signal, redirects + 1);
  }
  if (status < 200 || status >= 300) {
    response.destroy();
    throw new Error("URL resource server returned an error");
  }
  const contentType = response.headers["content-type"]
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType !== "image/png" ||
    (response.headers["content-encoding"] !== undefined &&
      response.headers["content-encoding"] !== "identity")
  ) {
    response.destroy();
    throw new Error("URL resources must be unencoded PNG images");
  }
  const contentLength = Number(response.headers["content-length"]);
  if (
    Number.isFinite(contentLength) &&
    contentLength > TERMINAL_RESOURCE_MAX_BYTES
  ) {
    response.destroy();
    throw new Error("URL resource exceeds the 32 MiB limit");
  }
  return response;
}

function isPathWithin(root: string, target: string): boolean {
  const relative = posix.relative(root, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith("../") &&
    !posix.isAbsolute(relative)
  );
}

function resolveFileResource(
  source: string,
  cwd: string,
  capability: TerminalCapability,
  allowDelete: boolean
): {
  root: TerminalCapability["rootDescriptors"][number];
  relative: string;
  mayDelete: boolean;
} {
  if (source.split("/").includes(".."))
    throw new Error("Path traversal is not permitted");
  const target = source.startsWith("/")
    ? posix.normalize(source)
    : posix.resolve(cwd, source);
  const matches = capability.rootDescriptors
    .filter((root) => isPathWithin(root.path, target))
    .sort((left, right) => right.path.length - left.path.length);
  const root = matches[0];
  if (!root) throw new Error("File is outside the authorized terminal roots");
  const relative = posix.relative(root.path, target);
  if (
    relative
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("Invalid terminal resource path");
  }
  const temporary = capability.temporaryRoots.some((temporaryRoot) =>
    isPathWithin(temporaryRoot, target)
  );
  return {
    root,
    relative,
    mayDelete:
      allowDelete &&
      temporary &&
      target.includes("tty-graphics-protocol"),
  };
}

const SAFE_FILE_READ_SCRIPT = String.raw`
import os, stat, sys

def write_all(fd, value):
    view = memoryview(value)
    while view:
        count = os.write(fd, view)
        if count <= 0:
            raise OSError("short output write")
        view = view[count:]

parent = os.dup(3)
file_fd = None
try:
    relative = sys.argv[1]
    parts = relative.split(os.sep)
    if not parts or any(part in ("", ".", "..") for part in parts):
        raise OSError("invalid relative path")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    for part in parts[:-1]:
        child = os.open(part, flags | getattr(os, "O_DIRECTORY", 0), dir_fd=parent)
        os.close(parent)
        parent = child
    file_fd = os.open(parts[-1], flags, dir_fd=parent)
    before = os.fstat(file_fd)
    if not stat.S_ISREG(before.st_mode):
        raise OSError("not a regular file")
    offset = int(sys.argv[2])
    requested = int(sys.argv[3])
    maximum = int(sys.argv[4])
    may_delete = sys.argv[5] == "1"
    os.lseek(file_fd, offset, os.SEEK_SET)
    remaining = maximum if requested == 0 else min(requested, maximum)
    total = 0
    while remaining > 0:
        block = os.read(file_fd, min(65536, remaining))
        if not block:
            if requested > 0:
                raise OSError("file ended before requested length")
            break
        write_all(1, block)
        total += len(block)
        remaining -= len(block)
    if requested == 0 and remaining == 0 and os.read(file_fd, 1):
        raise OSError("resource exceeds the 32 MiB limit")
    if total == 0:
        raise OSError("resource is empty")
    write_all(4, b"\x01")
    os.close(4)
    os.close(1)
    if may_delete:
        command = sys.stdin.buffer.read(1)
        if command == b"D":
            current = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            if (stat.S_ISREG(current.st_mode) and current.st_dev == before.st_dev and
                    current.st_ino == before.st_ino):
                os.unlink(parts[-1], dir_fd=parent)
finally:
    if file_fd is not None:
        os.close(file_fd)
    os.close(parent)
`;

function openFileResource(
  request: TerminalResourceRequest,
  capability: TerminalCapability,
  signal: AbortSignal
): ResourceSource {
  const { root, relative, mayDelete } = resolveFileResource(
    request.source,
    capability.cwd,
    capability,
    request.transport === "temporary-file"
  );
  const child = spawn(
    "python3",
    [
      "-c",
      SAFE_FILE_READ_SCRIPT,
      relative,
      String(request.offset),
      String(request.length),
      String(TERMINAL_RESOURCE_MAX_BYTES),
      mayDelete ? "1" : "0",
    ],
    {
      stdio: ["pipe", "pipe", "ignore", root.handle.fd, "pipe"],
    }
  );
  const stdout = child.stdout as Readable;
  const statusStream = child.stdio[4] as Readable | null;
  let statusByte = 0;
  const statusPromise = (async () => {
    if (!statusStream) return 0;
    for await (const chunk of statusStream) {
      if (chunk.byteLength > 0) statusByte = chunk[0] ?? 0;
    }
    return statusByte;
  })();
  let childError: Error | null = null;
  const exitPromise = new Promise<number>((resolve) => {
    child.once("error", (error) => {
      childError = error;
      resolve(-1);
    });
    child.once("exit", (code) => resolve(code ?? -1));
  });
  child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") childError = error;
  });
  const abort = () => child.kill("SIGKILL");
  signal.addEventListener("abort", abort, { once: true });

  async function* chunks(): AsyncGenerator<Uint8Array> {
    let total = 0;
    try {
      for await (const chunk of stdout) {
        if (signal.aborted) throw new Error("File resource request cancelled");
        const bytes = chunk as Uint8Array;
        total += bytes.byteLength;
        if (total > TERMINAL_RESOURCE_MAX_BYTES) {
          throw new Error("File resource exceeds the 32 MiB limit");
        }
        for (
          let offset = 0;
          offset < bytes.byteLength;
          offset += RESOURCE_READ_CHUNK_BYTES
        ) {
          yield bytes.subarray(
            offset,
            Math.min(offset + RESOURCE_READ_CHUNK_BYTES, bytes.byteLength)
          );
        }
      }
      if ((await statusPromise) !== 1)
        throw childError ?? new Error("Could not read terminal resource");
    } catch (error) {
      child.kill("SIGKILL");
      throw error;
    }
  }

  return {
    chunks: chunks(),
    abort,
    async finish(success) {
      signal.removeEventListener("abort", abort);
      if (mayDelete && child.stdin && !child.stdin.destroyed) {
        child.stdin.end(success && !signal.aborted ? "D" : "N");
      } else if (!success) {
        child.kill("SIGKILL");
      }
      const code = await exitPromise;
      if (success && !signal.aborted && code !== 0) {
        throw childError ?? new Error("Terminal resource reader failed");
      }
      await statusPromise;
    },
  };
}

function openUrlResource(
  request: TerminalResourceRequest,
  capability: TerminalCapability,
  signal: AbortSignal
): ResourceSource {
  if (request.format !== 100 || request.offset !== 0 || request.length !== 0) {
    throw new Error("URL transport only accepts whole PNG images");
  }
  if (!capability.urlImagesEnabled) {
    throw new Error("URL image transport is not enabled for this tmux session");
  }
  let parsed: URL;
  try {
    parsed = new URL(request.source);
  } catch {
    throw new Error("Invalid URL resource source");
  }
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    RESOURCE_TIMEOUT_MS
  );
  const abort = () => timeoutController.abort();
  signal.addEventListener("abort", abort, { once: true });
  const combinedSignal = timeoutController.signal;
  const streamPromise = openPngUrl(parsed, combinedSignal);
  return {
    async *chunks() {
      const stream = await streamPromise;
      let total = 0;
      const signature = new Uint8Array(8);
      let signatureLength = 0;
      const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
      for await (const chunk of stream) {
        if (signal.aborted || combinedSignal.aborted) {
          throw new Error("URL resource request cancelled");
        }
        const bytes = chunk as Uint8Array;
        total += bytes.byteLength;
        if (total > TERMINAL_RESOURCE_MAX_BYTES) {
          stream.destroy(new Error("URL resource exceeds the 32 MiB limit"));
          throw new Error("URL resource exceeds the 32 MiB limit");
        }
        if (signatureLength < signature.length) {
          const take = Math.min(
            signature.length - signatureLength,
            bytes.byteLength
          );
          signature.set(bytes.subarray(0, take), signatureLength);
          signatureLength += take;
          if (signatureLength === signature.length) {
            if (
              !pngSignature.every((value, index) => signature[index] === value)
            ) {
              stream.destroy(new Error("URL resource is not a PNG image"));
              throw new Error("URL resource is not a PNG image");
            }
            yield signature;
            for (
              let offset = take;
              offset < bytes.byteLength;
              offset += RESOURCE_READ_CHUNK_BYTES
            ) {
              yield bytes.subarray(
                offset,
                Math.min(offset + RESOURCE_READ_CHUNK_BYTES, bytes.byteLength)
              );
            }
            continue;
          }
          continue;
        }
        for (
          let offset = 0;
          offset < bytes.byteLength;
          offset += RESOURCE_READ_CHUNK_BYTES
        ) {
          yield bytes.subarray(
            offset,
            Math.min(offset + RESOURCE_READ_CHUNK_BYTES, bytes.byteLength)
          );
        }
      }
      if (total === 0 || signatureLength < signature.length) {
        throw new Error("URL resource is empty or truncated");
      }
    },
    finish: async () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    },
    abort: () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      timeoutController.abort();
      void streamPromise.then((stream) => stream.destroy()).catch(() => {});
    },
  };
}

async function openTerminalResource(
  request: TerminalResourceRequest,
  capability: TerminalCapability,
  signal: AbortSignal
): Promise<ResourceSource> {
  if (request.transport === "url")
    return openUrlResource(request, capability, signal);
  return openFileResource(request, capability, signal);
}

async function sendResourceChunks(
  request: TerminalResourceRequest,
  source: ResourceSource,
  signal: AbortSignal,
  send: SendTerminalResourceFrame
): Promise<void> {
  await send({
    version: TERMINAL_RESOURCE_PROTOCOL_VERSION,
    type: "ack",
    id: request.id,
  });
  const chunks =
    typeof source.chunks === "function" ? source.chunks() : source.chunks;
  const iterator = chunks[Symbol.asyncIterator]();
  let current = await iterator.next();
  let offset = 0;
  if (current.done) {
    await send({
      version: TERMINAL_RESOURCE_PROTOCOL_VERSION,
      type: "chunk",
      id: request.id,
      offset,
      total: 0,
      complete: true,
    });
    await source.finish(true);
    return;
  }

  while (!signal.aborted) {
    const next = await iterator.next();
    const bytes = current.value;
    const complete = next.done;
    if (bytes.byteLength > TERMINAL_RESOURCE_MAX_FRAME_BYTES) {
      throw new Error("Resource reader emitted an oversized chunk");
    }
    if (complete) await source.finish(true);
    await send(
      {
        version: TERMINAL_RESOURCE_PROTOCOL_VERSION,
        type: "chunk",
        id: request.id,
        offset,
        ...(complete ? { total: offset + bytes.byteLength } : {}),
        complete,
      },
      bytes
    );
    offset += bytes.byteLength;
    if (complete) return;
    current = next;
  }
  throw new Error("Terminal resource request cancelled");
}

export async function transferTerminalResource(
  request: TerminalResourceRequest,
  capability: TerminalCapability,
  signal: AbortSignal,
  send: SendTerminalResourceFrame
): Promise<void> {
  let source: ResourceSource | null = null;
  try {
    source = await openTerminalResource(request, capability, signal);
    await sendResourceChunks(request, source, signal, send);
  } catch {
    source?.abort();
    await source?.finish(false).catch(() => {});
    if (!signal.aborted) {
      await send({
        version: TERMINAL_RESOURCE_PROTOCOL_VERSION,
        type: "rejected",
        id: request.id,
        reason: "Terminal resource request failed",
      }).catch(() => {});
    }
  }
}
