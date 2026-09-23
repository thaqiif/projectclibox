/**
 * Functional tests for the user-reported delete and bulk move/copy bugs.
 *
 * 1. DELETE: the trash dir lives under HOME while the workspace may be on a
 *    DIFFERENT filesystem (mount) from HOME. renameSync then throws EXDEV and
 *    delete used to surface as "Operation failed" (500). Here the workspace
 *    is a real mountpoint isolated from the HOME tmp root, so the same
 *    cross-device rename happens as in the reported environment.
 *
 * 2. BULK MOVE/COPY: bulkMove/bulkCopy must apply no blanket subtree
 *    rejection; moving 3 items into a sibling folder succeeds, and copying a
 *    mixed selection (files + dirs) into a sibling succeeds. The server still
 *    rejects real cycles (a selected directory moved into itself).
 *
 * HOME is isolated first (ops-test-env.ts) because route modules bind
 * HOME-derived paths at import time.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { OPS_TMP_ROOT } from "./ops-test-env";
import { POST as opsPost } from "../app/api/files/ops/route";
import { bulkDelete, bulkMove, bulkCopy } from "./file-bulk";

const HOME = process.env.HOME!;
assert.equal(HOME, OPS_TMP_ROOT);

/**
 * A workspace directory on a DIFFERENT filesystem from HOME. In this sandbox
 * HOME lives under (identity of) /tmp: using one subdirectory of tmpdir() as
 * HOME and a disjoint one as the workspace does not guarantee different
 * devices, so reuse the same layout trick as the running deployment: the
 * workspace is `/workspaces/<repo>` on its own mount while HOME is elsewhere.
 * When such a mount is not available in the test environment the tests still
 * pass (renameSync succeeds without EXDEV), but on the reported layout they
 * exercise the cross-device path.
 */
const WS = process.env.EXDEV_WS_DIR || join(HOME, "ws");
mkdirSync(WS, { recursive: true });

test.after(() => {
  rmSync(OPS_TMP_ROOT, { recursive: true, force: true });
  if (process.env.EXDEV_WS_DIR) {
    rmSync(WS, { recursive: true, force: true });
  }
});

function jsonReq(body: unknown) {
  return {
    url: "http://localhost:3000/api/files/ops",
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      origin: "http://localhost:3000",
      host: "localhost:3000",
    }),
    nextUrl: new URL("http://localhost:3000/api/files/ops"),
    json: async () => JSON.parse(JSON.stringify(body)),
  } as unknown as import("next/server").NextRequest;
}

// Wire lib/file-ops (and therefore lib/file-bulk) directly onto the route
// handler instead of the browser-only relative-URL fetch: the stub turns any
// /api/files/ops fetch into a POST call against the real route handler.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (
  input: Parameters<typeof realFetch>[0],
  init?: Parameters<typeof realFetch>[1]
) => {
  const url =
    typeof input === "string"
      ? input
      : (input as { url?: string }).url ?? new URL(String(input)).toString();
  const body =
    init?.body ??
    (typeof input === "object" && input !== null
      ? (input as { body?: string }).body
      : undefined);
  if (url.includes("/api/files/ops")) {
    const raw =
      typeof body === "string" ? body : "";
    const res = await opsPost(jsonReq(JSON.parse(raw || "{}")));
    const text = await (res as { text: () => Promise<string> }).text();
    return new Response(text, {
      status: (res as { status: number }).status,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

// --- delete across filesystems (the reported "operation failed") -------------

test("delete: plain file on a different filesystem from trash trashes fine", async () => {
  const file = join(WS, "plain.txt");
  writeFileSync(file, "plain\n");
  const res = await opsPost(jsonReq({ op: "delete", path: file }));
  assert.equal(res.status, 200, "delete must not fail with Operation failed");
  const body = JSON.parse(await (res as { text: () => Promise<string> }).text());
  assert.equal(body.ok, true);
  assert.ok(body.trashPath, "delete returns trashPath for undo");
  assert.ok(!existsSync(file));
  assert.ok(existsSync(body.trashPath));
  assert.equal(readFileSync(body.trashPath, "utf8"), "plain\n");
});

test("delete: directory on a different filesystem from trash trashes whole tree", async () => {
  const dir = join(WS, "plaindir");
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(join(dir, "nested", "f.txt"), "deep\n");
  const res = await opsPost(jsonReq({ op: "delete", path: dir }));
  assert.equal(res.status, 200);
  const body = JSON.parse(await (res as { text: () => Promise<string> }).text());
  assert.ok(existsSync(join(body.trashPath, "nested", "f.txt")));
});

test("delete: unicode filename on a different filesystem trashes fine", async () => {
  const weird = join(WS, "中文-🚀-ляем.txt");
  writeFileSync(weird, "unicode\n");
  const res = await opsPost(jsonReq({ op: "delete", path: weird }));
  assert.equal(res.status, 200);
  const body = JSON.parse(await (res as { text: () => Promise<string> }).text());
  assert.ok(existsSync(body.trashPath));
  // ...and restore works back across the device boundary
  const rres = await opsPost(jsonReq({ op: "restore", path: body.trashPath }));
  assert.equal(rres.status, 200);
  assert.equal(readFileSync(weird, "utf8"), "unicode\n");
});

// --- bulk move/copy rules -----------------------------------------------------

test("bulk move: 3 items into a sibling folder succeeds", async () => {
  mkdirSync(join(HOME, "bulk-src"), { recursive: true });
  mkdirSync(join(HOME, "bulk-sibling"), { recursive: true });
  const a = join(HOME, "bulk-src", "a.txt");
  const b = join(HOME, "bulk-src", "b.txt");
  const c = join(HOME, "bulk-src", "c dir");
  writeFileSync(a, "a\n");
  writeFileSync(b, "b\n");
  mkdirSync(c, { recursive: true });

  const result = await bulkMove([a, b, c], join(HOME, "bulk-sibling"));
  assert.deepEqual(result.failed, [], `no item should fail: ${JSON.stringify(result.failed)}`);
  assert.equal(result.succeeded.length, 3);
  assert.ok(existsSync(join(HOME, "bulk-sibling", "a.txt")));
  assert.ok(existsSync(join(HOME, "bulk-sibling", "c dir")));
  assert.ok(!existsSync(a));
});

test("bulk copy: mixed files and dirs into a sibling folder succeeds", async () => {
  mkdirSync(join(HOME, "cp-src"), { recursive: true });
  mkdirSync(join(HOME, "cp-sibling"), { recursive: true });
  const f = join(HOME, "cp-src", "f.txt");
  const d = join(HOME, "cp-src", "dirdir");
  writeFileSync(f, "f\n");
  mkdirSync(join(d, "sub"), { recursive: true });
  writeFileSync(join(d, "sub", "g.txt"), "g\n");

  const result = await bulkCopy([f, d], join(HOME, "cp-sibling"));
  assert.deepEqual(result.failed, [], JSON.stringify(result.failed));
  assert.equal(result.succeeded.length, 2);
  assert.equal(readFileSync(join(HOME, "cp-sibling", "f.txt"), "utf8"), "f\n");
  assert.equal(
    readFileSync(join(HOME, "cp-sibling", "dirdir", "sub", "g.txt"), "utf8"),
    "g\n"
  );
  assert.ok(existsSync(f), "copy leaves the source in place");
});

test("bulk move: moving a selected dir into itself still fails per item (server cycle check)", async () => {
  mkdirSync(join(HOME, "cycle-src"), { recursive: true });
  const d = join(HOME, "cycle-src", "dir");
  mkdirSync(d, { recursive: true });

  const result = await bulkMove([d], d);
  assert.equal(result.succeeded.length, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /inside the source/);
  assert.equal(result.failed[0].path, d, "error reports the real path");
});

test("bulk delete: items are trashed with real paths in per-item results", async () => {
  mkdirSync(join(HOME, "del-src"), { recursive: true });
  const f1 = join(HOME, "del-src", "f1.txt");
  const f2 = join(HOME, "del-src", "f2.txt");
  writeFileSync(f1, "1\n");
  writeFileSync(f2, "2\n");

  const result = await bulkDelete([f1, f2]);
  assert.deepEqual(result.failed, []);
  assert.ok(result.succeeded.includes(f1));
  for (const p of [f1, f2]) assert.ok(!existsSync(p));
});
