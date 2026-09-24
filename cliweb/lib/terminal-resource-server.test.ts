import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TerminalCapability } from "./terminal-capabilities";
import {
  isPublicAddress,
  parseTerminalResourceRequest,
  transferTerminalResource,
  waitForAbort,
} from "./terminal-resource-server";

async function makeCapability(
  cwd: string,
  temporaryRoots: string[] = []
): Promise<{ capability: TerminalCapability; close: () => Promise<void> }> {
  const roots = [cwd, ...temporaryRoots.filter((path) => path !== cwd)];
  const rootDescriptors = await Promise.all(
    roots.map(async (path) => {
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      );
      const info = await handle.stat();
      return {
        path,
        handle,
        device: info.dev,
        inode: info.ino,
        temporary: temporaryRoots.includes(path),
      };
    })
  );
  return {
    capability: {
      sessionId: "$1",
      server: { pid: 1, startTime: "test" },
      cwd,
      roots,
      temporaryRoots,
      rootDescriptors,
      urlImagesEnabled: false,
      expiresAt: Date.now() + 60_000,
    },
    close: async () => {
      await Promise.all(rootDescriptors.map(({ handle }) => handle.close()));
    },
  };
}

function request(
  source: string,
  transport: "file" | "temporary-file" | "url" = "file",
  overrides: Record<string, unknown> = {}
): ReturnType<typeof parseTerminalResourceRequest> {
  return parseTerminalResourceRequest({
    version: 1,
    type: "request",
    id: 1,
    transport,
    source,
    offset: 0,
    length: 0,
    width: 0,
    height: 0,
    format: 100,
    ...overrides,
  });
}

async function runTransfer(
  resourceRequest: ReturnType<typeof parseTerminalResourceRequest>,
  capability: TerminalCapability
): Promise<Array<{ header: Record<string, unknown>; bytes: Uint8Array }>> {
  const frames: Array<{ header: Record<string, unknown>; bytes: Uint8Array }> =
    [];
  await transferTerminalResource(
    resourceRequest,
    capability,
    new AbortController().signal,
    async (header, bytes) => {
      frames.push({ header, bytes: bytes?.slice() ?? new Uint8Array() });
    }
  );
  return frames;
}

test("resource request headers enforce the protocol and resource limits", () => {
  assert.throws(() => request("image.png", "file", { version: 2 }));
  assert.throws(() => request("image.png", "file", { offset: -1 }));
  assert.throws(() =>
    request("image.png", "file", { length: 32 * 1024 * 1024 + 1 })
  );
  assert.throws(() => request("image.png", "file", { width: 10_001 }));
  assert.throws(() => request("image.png", "file", { format: 8 }));
});

test("URL address checks reject loopback, private, link-local and reserved addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.8",
    "172.20.1.2",
    "192.168.0.1",
    "169.254.169.254",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicAddress("::ffff:7f00:1"), false);
});

test("URL host resolution observes the resource abort deadline", async () => {
  const controller = new AbortController();
  const unresolved = new Promise<never>(() => {});
  const pending = waitForAbort(unresolved, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/u);
});

test("URL resource requests enforce session negotiation and the HTTP(S) URL policy", async () => {
  const capability: TerminalCapability = {
    sessionId: "$1",
    server: { pid: 1, startTime: "test" },
    cwd: "/tmp",
    roots: [],
    temporaryRoots: [],
    rootDescriptors: [],
    urlImagesEnabled: false,
    expiresAt: Date.now() + 60_000,
  };

  const notNegotiated = await runTransfer(
    request("https://images.example/image.png", "url"),
    capability
  );
  assert.equal(notNegotiated.at(-1)?.header.type, "rejected");

  capability.urlImagesEnabled = true;
  for (const source of [
    "file:///etc/passwd",
    "https://user:password@images.example/image.png",
    "https://images.example:8443/image.png",
    "http://127.0.0.1/image.png",
    "http://[::1]/image.png",
  ]) {
    const frames = await runTransfer(request(source, "url"), capability);
    assert.equal(frames.at(-1)?.header.type, "rejected", source);
  }
});

test("file transport reads beneath the pinned directory descriptor", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "cliweb-resource-test-"));
  const cwd = join(base, "cwd");
  const outside = join(base, "outside.png");
  await mkdir(cwd);
  await writeFile(outside, Buffer.from([0, 1, 2, 3]));
  await writeFile(join(cwd, "inside.png"), Buffer.from([4, 5, 6, 7]));
  await symlink(outside, join(cwd, "linked.png"));
  const root = await realpath(cwd);
  const { capability, close } = await makeCapability(root);
  t.after(async () => {
    await close();
    await rm(base, { recursive: true, force: true });
  });

  const frames = await runTransfer(request("inside.png"), capability);
  assert.deepEqual(
    frames.map(({ header }) => header.type),
    ["ack", "chunk"]
  );
  assert.deepEqual([...frames[1]!.bytes], [4, 5, 6, 7]);
  assert.equal(frames[1]!.header.complete, true);

  for (const blocked of ["../outside.png", "linked.png", outside]) {
    const blockedFrames = await runTransfer(request(blocked), capability);
    assert.equal(blockedFrames.at(-1)?.header.type, "rejected", blocked);
  }
});

test("temporary transport deletes only a fully read Kitty marker file in a temp root", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "cliweb-resource-temp-test-"));
  const cwd = join(base, "cwd");
  const temporary = join(base, "tmp");
  await mkdir(cwd);
  await mkdir(temporary);
  const marked = join(temporary, "tty-graphics-protocol-image.data");
  const unmarked = join(temporary, "ordinary-image.data");
  const markerDirectory = join(temporary, "tty-graphics-protocol-cache");
  await mkdir(markerDirectory);
  const markedByParent = join(markerDirectory, "image.data");
  await writeFile(marked, Buffer.from([1, 2, 3, 4]));
  await writeFile(unmarked, Buffer.from([5, 6, 7, 8]));
  await writeFile(markedByParent, Buffer.from([9, 10, 11, 12]));
  const { capability, close } = await makeCapability(await realpath(cwd), [
    await realpath(temporary),
  ]);
  t.after(async () => {
    await close();
    await rm(base, { recursive: true, force: true });
  });

  const completed = await runTransfer(
    request(marked, "file"),
    capability
  );
  assert.equal(completed.at(-1)?.header.complete, true);
  assert.deepEqual(await readFile(marked), Buffer.from([1, 2, 3, 4]));

  const removed = await runTransfer(
    request(marked, "temporary-file"),
    capability
  );
  assert.equal(removed.at(-1)?.header.complete, true);
  await assert.rejects(readFile(marked));

  await runTransfer(request(markedByParent, "temporary-file"), capability);
  await assert.rejects(readFile(markedByParent));

  await runTransfer(request(unmarked, "temporary-file"), capability);
  assert.deepEqual(await readFile(unmarked), Buffer.from([5, 6, 7, 8]));
});

test("temporary transport keeps a file when the requested read is truncated", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "cliweb-resource-truncated-test-"));
  const cwd = join(base, "cwd");
  await mkdir(cwd);
  const file = join(cwd, "tty-graphics-protocol-image.data");
  await writeFile(file, Buffer.from([1, 2, 3]));
  const { capability, close } = await makeCapability(await realpath(cwd), [
    await realpath(cwd),
  ]);
  t.after(async () => {
    await close();
    await rm(base, { recursive: true, force: true });
  });

  const frames = await runTransfer(
    request(file, "temporary-file", { length: 8 }),
    capability
  );
  assert.equal(frames.at(-1)?.header.type, "rejected");
  assert.deepEqual(await readFile(file), Buffer.from([1, 2, 3]));
});
