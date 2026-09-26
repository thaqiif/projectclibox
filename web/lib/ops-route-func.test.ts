/**
 * Functional tests hitting /api/files API route handlers directly with fake
 * NextRequest objects. HOME is isolated first (ops-test-env.ts) because the
 * route modules bind HOME-derived paths (trash dir) at import time.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { OPS_TMP_ROOT } from "./ops-test-env";
import { POST as opsPost } from "../app/api/files/ops/route";
import { GET as listGet } from "../app/api/files/route";
import { GET as downloadGet } from "../app/api/files/download/route";
import { POST as contentPost, GET as contentGet } from "../app/api/files/content/route";
import { GET as zipGet } from "../app/api/files/zip/route";
import {
  chmodSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";

// ops-test-env.ts already forces process.env.HOME to the isolated root.
const HOME = process.env.HOME!;
assert.equal(HOME, OPS_TMP_ROOT);

const WS = join(HOME, "ws");
mkdirSync(join(WS, "dir-a"), { recursive: true });
mkdirSync(join(WS, "dir-a", "sub"), { recursive: true });
mkdirSync(join(WS, "nested", "deeper"), { recursive: true });
mkdirSync(join(WS, "dest"), { recursive: true });
writeFileSync(join(WS, "text.txt"), "hello ops\n");
writeFileSync(join(WS, "dir-a", "f.txt"), "in a\n");
writeFileSync(join(WS, "nested", "deeper", "g.txt"), "deep\n");
writeFileSync(join(WS, "dest", "text.txt"), "target\n");
writeFileSync(join(WS, ".secret"), "hush");

test.after(() => {
  rmSync(OPS_TMP_ROOT, { recursive: true, force: true });
});

function jsonReq(url: string, body: unknown) {
  return {
    url,
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      origin: "http://localhost:3000",
      host: "localhost:3000",
    }),
    nextUrl: new URL(url),
    json: async () => JSON.parse(JSON.stringify(body)),
  } as unknown as import("next/server").NextRequest;
}

function getReq(url: string) {
  return {
    url,
    method: "GET",
    headers: new Headers(),
    nextUrl: new URL(url),
  } as unknown as import("next/server").NextRequest;
}

async function status(res: unknown): Promise<number> {
  return (res as { status: number }).status;
}
async function data(res: unknown): Promise<Record<string, unknown>> {
  return JSON.parse(await (res as { text: () => Promise<string> }).text());
}

// --- move into own descendant -----------------------------------------------

test("move: moving a dir into its own descendant is blocked", async () => {
  const res = await opsPost(
    jsonReq("http://x/api/files/ops", {
      op: "move",
      path: `${WS}/dir-a`,
      to: `${WS}/dir-a/sub`,
    })
  );
  assert.equal(await status(res), 400);
  assert.ok(existsSync(`${WS}/dir-a/f.txt`));
});

test("move: moving a dir into itself is blocked", async () => {
  const res = await opsPost(
    jsonReq("http://x/api/files/ops", {
      op: "move",
      path: `${WS}/dir-a`,
      to: `${WS}/dir-a`,
    })
  );
  assert.equal(await status(res), 400);
});

test("rename: renaming a dir to a path inside itself is blocked", async () => {
  const res = await opsPost(
    jsonReq("http://x/api/files/ops", {
      op: "rename",
      path: `${WS}/dir-a`,
      to: `${WS}/dir-a/renamed`,
    })
  );
  assert.equal(await status(res), 400);
  assert.ok(existsSync(`${WS}/dir-a/f.txt`));
});

test("move: a legitimate move still works after the guard", async () => {
  writeFileSync(`${WS}/movable.txt`, "movable\n");
  const res = await opsPost(
    jsonReq("http://x/api/files/ops", {
      op: "move",
      path: `${WS}/movable.txt`,
      to: `${WS}/dest`,
    })
  );
  assert.equal(await status(res), 200);
  assert.ok(existsSync(`${WS}/dest/movable.txt`));
});

// --- delete with symlinks ----------------------------------------------------

test("delete: directory containing symlinks trashes fine and restores", async () => {
  symlinkSync(`${WS}/dest/text.txt`, `${WS}/dir-a/link.txt`);
  const res = await opsPost(
    jsonReq("http://x/api/files/ops", { op: "delete", path: `${WS}/dir-a` })
  );
  assert.equal(await status(res), 200);
  const body = await data(res);
  const trashPath = body.trashPath as string;
  assert.ok(trashPath.startsWith(`${HOME}/.clibox/.trash/`));
  assert.ok(existsSync(`${trashPath}/f.txt`));
  const rres = await opsPost(
    jsonReq("http://x/api/files/ops", { op: "restore", path: trashPath })
  );
  assert.equal(await status(rres), 200);
  const rbody = await data(rres);
  assert.equal(rbody.restoredTo, `${WS}/dir-a`);
  assert.ok(existsSync(`${WS}/dir-a/link.txt`));
});

test("delete: deleting a symlink itself trashes the link, not the target", async () => {
  symlinkSync(`${WS}/dest/text.txt`, `${WS}/link2`);
  const res = await opsPost(
    jsonReq("http://x/api/files/ops", { op: "delete", path: `${WS}/link2` })
  );
  assert.equal(await status(res), 200);
  assert.ok(existsSync(`${WS}/dest/text.txt`));
  const body = await data(res);
  const pres = await opsPost(
    jsonReq("http://x/api/files/ops", { op: "purge", path: body.trashPath })
  );
  assert.equal(await status(pres), 200);
  assert.ok(existsSync(`${WS}/dest/text.txt`));
});

// --- purge outside the trash directory --------------------------------------

test("purge: refuses paths outside the trash directory", async () => {
  const res = await opsPost(
    jsonReq("http://x/api/files/ops", { op: "purge", path: `${WS}/dest` })
  );
  assert.equal(await status(res), 400);
  assert.ok(existsSync(`${WS}/dest/text.txt`), "workspace must survive");
});

test("purge: refuses sibling imitation trash dirs", async () => {
  mkdirSync(`${HOME}/.clibox2/.trash/x`, { recursive: true });
  const res = await opsPost(
    jsonReq("http://x/api/files/ops", {
      op: "purge",
      path: `${HOME}/.clibox2/.trash/x`,
    })
  );
  assert.equal(await status(res), 400);
  assert.ok(existsSync(`${HOME}/.clibox2/.trash/x`));
});

test("purge: still works on real trash contents", async () => {
  const res = await opsPost(
    jsonReq("http://x/api/files/ops", {
      op: "delete",
      path: `${WS}/nested/deeper/g.txt`,
    })
  );
  const body = await data(res);
  const pres = await opsPost(
    jsonReq("http://x/api/files/ops", { op: "purge", path: body.trashPath })
  );
  assert.equal(await status(pres), 200);
  assert.ok(!existsSync(body.trashPath as string));
});

// --- traversal / weird paths -------------------------------------------------

test("ops: path traversal is rejected", async () => {
  const res = await opsPost(
    jsonReq("http://x/api/files/ops", {
      op: "delete",
      path: `${WS}/../elsewhere`,
    })
  );
  assert.equal(await status(res), 400);
});

// --- showHidden parameter ----------------------------------------------------

test("list: (characterisation) shows .secret by default and with showHidden=true", async () => {
  const res = await listGet(getReq(`http://x/api/files?path=${encodeURIComponent(WS)}`));
  const body = await data(res);
  assert.ok(
    (body.files as { name: string }[]).some((f) => f.name === ".secret")
  );
  const hidden = await listGet(
    getReq(`http://x/api/files?path=${encodeURIComponent(WS)}&showHidden=true`)
  );
  const hbody = await data(hidden);
  assert.ok((hbody.files as { name: string }[]).some((f) => f.name === ".secret"));
});

test("list: showHidden=<garbage> does not act as truthy", async () => {
  mkdirSync(`${WS}/.git`, { recursive: true });
  const res = await listGet(
    getReq(`http://x/api/files?path=${encodeURIComponent(WS)}&showHidden=garbage`)
  );
  const gbody = await data(res);
  assert.ok(
    !(gbody.files as { name: string }[]).some((f) => f.name === ".git"),
    "only the literal 'true' may bypass exclusions"
  );
});

// --- content route -----------------------------------------------------------

test("content GET reads text; POST writes and reports mtime", async () => {
  const res = await contentGet(
    getReq(
      `http://x/api/files/content?path=${encodeURIComponent(`${WS}/dest/text.txt`)}`
    )
  );
  assert.equal(await status(res), 200);
  const body = await data(res);
  assert.equal(body.content, "target\n");
  assert.equal(typeof body.mtimeMs, "number");

  const post = await contentPost(
    jsonReq("http://x/api/files/content", {
      path: `${WS}/dest/text.txt`,
      content: "written\n",
    })
  );
  assert.equal(await status(post), 200);
  assert.equal(readFileSync(`${WS}/dest/text.txt`, "utf8"), "written\n");
});

test("content: conflict detection returns 409 on stale mtime", async () => {
  const stat = statSync(`${WS}/dest/text.txt`);
  const post = await contentPost(
    jsonReq("http://x/api/files/content", {
      path: `${WS}/dest/text.txt`,
      content: "clobber\n",
      expectedMtimeMs: stat.mtimeMs - 9999,
    })
  );
  assert.equal(await status(post), 409);
  assert.equal(readFileSync(`${WS}/dest/text.txt`, "utf8"), "written\n");
});

test("content: refuses to overwrite binary file with text (415)", async () => {
  writeFileSync(`${WS}/bin.dat`, Buffer.alloc(100, 0));
  const post = await contentPost(
    jsonReq("http://x/api/files/content", {
      path: `${WS}/bin.dat`,
      content: "text",
    })
  );
  assert.equal(await status(post), 415);
});

test("content: POST rejects path traversal", async () => {
  const post = await contentPost(
    jsonReq("http://x/api/files/content", {
      path: `${WS}/../../tmp/traversal.txt`,
      content: "no",
    })
  );
  assert.ok([400, 500].includes(await status(post)));
  assert.ok(!existsSync(`/tmp/traversal.txt`));
});

test("content GET rejects path traversal", async () => {
  const res = await contentGet(
    getReq(
      `http://x/api/files/content?path=${encodeURIComponent(`${WS}/../../etc/passwd`)}`
    )
  );
  assert.ok([400, 500].includes(await status(res)));
});

// --- download ----------------------------------------------------------------

test("download: symlink target bytes are served", async () => {
  symlinkSync(`${WS}/dest/text.txt`, `${WS}/dl-link`);
  const res = await downloadGet(
    getReq(
      `http://x/api/files/download?path=${encodeURIComponent(`${WS}/dl-link`)}`
    )
  );
  assert.equal(await status(res), 200);
  const text = await (res as unknown as { text: () => Promise<string> }).text();
  assert.equal(text, "written\n");
});

test("download: dangling symlink responses without crash", async () => {
  symlinkSync(`${WS}/no-such-file`, `${WS}/dangling`);
  const res = await downloadGet(
    getReq(
      `http://x/api/files/download?path=${encodeURIComponent(`${WS}/dangling`)}`
    )
  );
  const s = await status(res);
  assert.ok(s >= 400 && s < 600);
});

test("download: rejects traversal", async () => {
  const res = await downloadGet(
    getReq(
      `http://x/api/files/download?path=${encodeURIComponent(`${WS}/../../etc/passwd`)}`
    )
  );
  assert.equal(await status(res), 400);
});

// --- zip ---------------------------------------------------------------------

test("zip: rejects traversal", async () => {
  const res = await zipGet(
    getReq(`http://x/api/files/zip?path=${encodeURIComponent(`${WS}/../..`)}`)
  );
  assert.equal(await status(res), 400);
});

test("zip: archives a small tree successfully", async () => {
  const res = await zipGet(
    getReq(`http://x/api/files/zip?path=${encodeURIComponent(`${WS}/dest`)}`)
  );
  assert.equal(await status(res), 200);
  const buf = await (res as unknown as { text: () => Promise<string> }).text();
  assert.equal(buf.charCodeAt(0), 0x50); // PK
  assert.equal(buf.charCodeAt(1), 0x4b);
});

test("zip: over-depth tree returns 413 without hanging", async () => {
  mkdirSync(`${WS}/ziptest`, { recursive: true });
  let deep = `${WS}/ziptest`;
  for (let i = 0; i < 25; i++) {
    deep = join(deep, `d${i}`); // real nesting, not a long sibling name
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, "f.txt"), "x");
  }
  const res = await zipGet(
    getReq(`http://x/api/files/zip?path=${encodeURIComponent(`${WS}/ziptest`)}`)
  );
  const s = await status(res);
  assert.equal(s, 413);
});

// --- unicode trash paths ------------------------------------------------------

test("delete: unicode filename trashes, restores with meta intact", async () => {
  const weird = `${WS}/中文-#%-emoji-🚀.txt`;
  writeFileSync(weird, "unicode\n");
  const res = await opsPost(
    jsonReq("http://x/api/files/ops", { op: "delete", path: weird })
  );
  assert.equal(await status(res), 200);
  const body = await data(res);
  assert.ok(existsSync(body.trashPath as string), "trashed file exists");
  const meta = JSON.parse(
    readFileSync(`${body.trashPath}.meta.json`, "utf8")
  );
  assert.equal(meta.origPath, weird);
  const rres = await opsPost(
    jsonReq("http://x/api/files/ops", { op: "restore", path: body.trashPath })
  );
  assert.equal(await status(rres), 200);
  assert.equal(readFileSync(weird, "utf8"), "unicode\n");
});

// --- createFile race ---------------------------------------------------------

test("createFile: two concurrent creates -> one 200 and one 409", async () => {
  const [a, b] = await Promise.all([
    opsPost(jsonReq("http://x/api/files/ops", { op: "createFile", path: `${WS}/racefile` })),
    opsPost(jsonReq("http://x/api/files/ops", { op: "createFile", path: `${WS}/racefile` })),
  ]);
  const statuses = [(await status(a)), (await status(b))].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(readFileSync(`${WS}/racefile`, "utf8"), "");
});

// --- trash slot reservation --------------------------------------------------

const TRASH = `${HOME}/.clibox/.trash`;

/** Same stamp the route uses to name a trash slot for the given time. */
function slotStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "");
}

test("delete: an orphaned trash meta cannot hijack the next delete of that name", async () => {
  // A crash between purge's item removal and its metadata removal leaves a
  // metadata file with no item. Claim that slot for the next few seconds so
  // the delete below is guaranteed to meet it as its first candidate.
  const base = "orphan-hijack.txt";
  const staleOrig = `${WS}/stale-location/${base}`;
  const orphanSlots: string[] = [];
  for (let ahead = 0; ahead < 4; ahead++) {
    const slot = join(TRASH, `${base}.${slotStamp(new Date(Date.now() + ahead * 1000))}`);
    mkdirSync(TRASH, { recursive: true });
    writeFileSync(
      `${slot}.meta.json`,
      JSON.stringify({ origPath: staleOrig, trashPath: slot, deletedAt: "2020-01-01T00:00:00.000Z" })
    );
    orphanSlots.push(slot);
  }

  const real = `${WS}/orphan-source`;
  mkdirSync(real, { recursive: true });
  const source = join(real, base);
  writeFileSync(source, "real content\n");

  const res = await opsPost(
    jsonReq("http://x/api/files/ops", { op: "delete", path: source })
  );
  assert.equal(await status(res), 200);
  const body = await data(res);
  const trashPath = body.trashPath as string;
  assert.ok(!orphanSlots.includes(trashPath), "must not reuse the orphaned slot");
  assert.equal(existsSync(trashPath), true);

  // The recorded original path describes THIS item, not the orphaned one.
  const meta = JSON.parse(readFileSync(`${trashPath}.meta.json`, "utf8"));
  assert.equal(meta.origPath, source);

  const rres = await opsPost(
    jsonReq("http://x/api/files/ops", { op: "restore", path: trashPath })
  );
  assert.equal(await status(rres), 200);
  assert.equal(readFileSync(source, "utf8"), "real content\n");
  assert.equal(existsSync(staleOrig), false, "never restored to the stale location");
});

test("delete: concurrent same-name deletes keep both items and their own metadata", async () => {
  const base = "same-second.txt";
  const firstDir = `${WS}/concurrent-a`;
  const secondDir = `${WS}/concurrent-b`;
  mkdirSync(firstDir, { recursive: true });
  mkdirSync(secondDir, { recursive: true });
  const first = join(firstDir, base);
  const second = join(secondDir, base);
  writeFileSync(first, "first\n");
  writeFileSync(second, "second\n");

  const [a, b] = await Promise.all([
    opsPost(jsonReq("http://x/api/files/ops", { op: "delete", path: first })),
    opsPost(jsonReq("http://x/api/files/ops", { op: "delete", path: second })),
  ]);
  assert.equal(await status(a), 200);
  assert.equal(await status(b), 200);
  const firstTrash = (await data(a)).trashPath as string;
  const secondTrash = (await data(b)).trashPath as string;
  assert.notEqual(firstTrash, secondTrash, "each delete gets its own slot");

  // Both payloads survive: the loser must not be clobbered by the winner.
  const contents = [
    readFileSync(firstTrash, "utf8"),
    readFileSync(secondTrash, "utf8"),
  ].sort();
  assert.deepEqual(contents, ["first\n", "second\n"]);

  // ...and each slot's metadata points at the item that is really in it.
  const origByTrash: Record<string, string> = {
    [firstTrash]: JSON.parse(readFileSync(`${firstTrash}.meta.json`, "utf8")).origPath,
    [secondTrash]: JSON.parse(readFileSync(`${secondTrash}.meta.json`, "utf8")).origPath,
  };
  assert.deepEqual(
    [origByTrash[firstTrash], origByTrash[secondTrash]].sort(),
    [first, second].sort()
  );
});

test("delete: a failed move releases its reserved slot instead of stranding metadata", async () => {
  const base = "unmovable.txt";
  const locked = `${WS}/readonly-parent`;
  mkdirSync(locked, { recursive: true });
  const source = join(locked, base);
  writeFileSync(source, "stuck\n");
  // Renaming out of a directory needs write permission on that directory.
  chmodSync(locked, 0o555);
  try {
    const res = await opsPost(
      jsonReq("http://x/api/files/ops", { op: "delete", path: source })
    );
    assert.notEqual(await status(res), 200, "the delete must report the failure");
    assert.ok(existsSync(source), "source stays put");
  } finally {
    chmodSync(locked, 0o755);
  }

  // No metadata for an item that never arrived.
  const strays = existsSync(TRASH)
    ? readdirSync(TRASH).filter((name) => name.startsWith(`${base}.`))
    : [];
  assert.deepEqual(strays, [], "no stranded metadata or item");
});
