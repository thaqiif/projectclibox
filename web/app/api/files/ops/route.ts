import { NextRequest, NextResponse } from "next/server";
import {
  copyFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  statSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from "fs";
import { resolve, dirname, basename, join } from "path";
import { guardJsonSameOrigin } from "@/lib/route-guards";
import { cliboxDataDir } from "@/lib/runtime-environment";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";
import { renameAcrossDevices } from "@/lib/rename-across-devices";

/**
 * Trash directory for "soft" deletes: deleted items are moved here instead of
 * being permanently removed, together with a <name>.meta.json sibling that
 * records the original absolute path so they can be restored.
 */
// Trash lives inside the CLIBox data directory (.clibox by default, or
// .clibox-<profile> when CLIBOX_PROFILE is set), so each deployment has a
// single self-contained data folder and they never share data.
const TRASH_DIR = join(cliboxDataDir(), ".trash");

interface TrashMeta {
  origPath: string;
  trashPath: string;
  deletedAt: string;
}

function metaPathFor(trashPath: string): string {
  return `${trashPath}.meta.json`;
}

function readTrashMeta(trashPath: string): TrashMeta | null {
  try {
    const parsed = JSON.parse(
      readFileSync(metaPathFor(trashPath), "utf8")
    ) as Partial<TrashMeta>;
    if (!parsed || typeof parsed.origPath !== "string" || !parsed.origPath) {
      return null;
    }
    return {
      origPath: parsed.origPath,
      trashPath: typeof parsed.trashPath === "string" ? parsed.trashPath : trashPath,
      deletedAt: typeof parsed.deletedAt === "string" ? parsed.deletedAt : "",
    };
  } catch {
    return null;
  }
}

function writeTrashMeta(meta: TrashMeta): void {
  writeFileSync(metaPathFor(meta.trashPath), JSON.stringify(meta, null, 2), {
    flag: "wx",
  });
}

/**
 * Reserve a free trash slot for `origPath` and return its trash path.
 *
 * The slot is claimed by creating its metadata file with an exclusive create
 * (`wx`) before the item is moved, so claiming a slot and recording its
 * metadata are one step: the metadata can only ever describe the item that is
 * about to land in that slot. (Today the whole handler is synchronous, so a
 * single process cannot interleave two deletes; the exclusive create keeps the
 * invariant true if that ever changes.)
 *
 * A slot whose metadata exists without its item - an orphan left by a crash
 * between purge's two removals - is skipped rather than reused. Reusing it left
 * the stale `origPath` in place, so the next delete of the same name produced a
 * trash entry whose restore moved the new item to the previous item's location.
 *
 * The caller must remove the reserved metadata if the move then fails.
 */
function reserveTrashSlot(origPath: string): string {
  const base = basename(origPath);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "");
  for (let n = 0; ; n++) {
    const candidate = join(
      TRASH_DIR,
      n === 0 ? `${base}.${stamp}` : `${base}.${stamp}-${n - 1}`
    );
    // An item already sitting in this slot owns it (its metadata may be
    // missing if that write failed), so move on to the next suffix.
    if (existsSync(candidate)) continue;
    try {
      writeTrashMeta({
        origPath,
        trashPath: candidate,
        deletedAt: new Date().toISOString(),
      });
      return candidate;
    } catch (error) {
      // Orphaned metadata occupies this slot; leave it and try the next one.
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
  }
}

/**
 * copyDir caps: guard against runaway recursion and unbounded size.
 * Depth counts levels below the copied root; the total byte budget counts
 * regular file bytes (symlinks are skipped, not followed).
 */
const COPY_DIR_MAX_DEPTH = 20;
const COPY_DIR_MAX_TOTAL_BYTES = MAX_UPLOAD_BYTES; // 200MB, matches upload cap

interface CopyBudget {
  bytes: number;
}

function copyLimitError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Recursively copy directory `src` to `dest` synchronously.
 * - Creates `dest` (and missing parents) with mkdirSync recursive.
 * - Skips symlinks (lstat, never follow) and other non-regular entries.
 * - Throws ECOPYDEPTH past COPY_DIR_MAX_DEPTH, ECOPYBYTES past
 *   COPY_DIR_MAX_TOTAL_BYTES cumulative file bytes.
 */
function copyDirRecursive(
  src: string,
  dest: string,
  depth: number,
  budget: CopyBudget
): void {
  if (depth > COPY_DIR_MAX_DEPTH) {
    throw copyLimitError(
      "ECOPYDEPTH",
      `Directory nesting exceeds the copy depth limit (${COPY_DIR_MAX_DEPTH})`
    );
  }
  const st = lstatSync(src);
  if (st.isSymbolicLink()) {
    return; // skip symlinks, do not follow
  }
  if (st.isFile()) {
    budget.bytes += st.size;
    if (budget.bytes > COPY_DIR_MAX_TOTAL_BYTES) {
      throw copyLimitError(
        "ECOPYBYTES",
        `Copy exceeds the total size limit of ${Math.round(
          COPY_DIR_MAX_TOTAL_BYTES / (1024 * 1024)
        )}MB`
      );
    }
    copyFileSync(src, dest);
    return;
  }
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      copyDirRecursive(join(src, entry), join(dest, entry), depth + 1, budget);
    }
    return;
  }
  // FIFOs, sockets, devices etc. are skipped
}

/**
 * POST /api/files/ops
 * JSON body: { op: "mkdir" | "createFile" | "rename" | "move" | "copy" | "copyDir" | "delete" | "restore" | "purge", path: string, to?: string, force?: boolean }
 *
 * copyDir: recursive directory copy. "to" is a destination directory; the
 * source basename is joined onto it. 409 if the destination exists unless
 * force. Refuses to copy a directory into itself. Caps: depth 20, 200MB
 * total file bytes, symlinks skipped.
 *
 * delete: move the target into ~/.clibox/.trash/ (soft delete, returns trashPath).
 * restore: { path: trashPath, to?: original override } move it back to its
 *   original location (409 if that exists, unless force).
 * purge: permanently remove a trashed item and its metadata file.
 */
export async function POST(request: NextRequest) {
  const guard = guardJsonSameOrigin(request);
  if (guard) return guard;

  let body: {
    op?: string;
    path?: string;
    to?: string;
    content?: string;
    force?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { op, path: rawPath, to: rawTo, force = false } = body;

  if (!op || !rawPath) {
    return NextResponse.json(
      { error: "op and path are required" },
      { status: 400 }
    );
  }

  if (
    ![
      "mkdir",
      "createFile",
      "rename",
      "move",
      "copy",
      "copyDir",
      "delete",
      "restore",
      "purge",
    ].includes(op)
  ) {
    return NextResponse.json(
      { error: `Unsupported op: ${op}` },
      { status: 400 }
    );
  }

  // Expand ~ to home directory, consistent with the other file routes.
  // Traversal is rejected on the RAW expanded string before resolve, because
  // resolve absorbs ".." segments (a post-resolve check can never catch them;
  // the old predicate was effectively dead code). Same rule as upload-temp.
  const expand = (p: string) => {
    const expanded = p.replace(/^~(?=\/|$)/, process.env.HOME || "");
    if (expanded.split("/").includes("..")) {
      return null;
    }
    return resolve(expanded);
  };

  const path = expand(rawPath);

  if (path === null) {
    return NextResponse.json(
      { error: "Path traversal is not allowed" },
      { status: 400 }
    );
  }

  // Reject root "/" as target
  if (path === "/" || path === "") {
    return NextResponse.json(
      { error: "Invalid target path" },
      { status: 400 }
    );
  }

  let to: string | undefined;
  if (
    op === "rename" ||
    op === "move" ||
    op === "copy" ||
    op === "copyDir" ||
    (op === "restore" && rawTo !== undefined)
  ) {
    if (!rawTo) {
      return NextResponse.json(
        { error: `to is required for ${op}` },
        { status: 400 }
      );
    }
    const expandedTo = expand(rawTo);
    if (expandedTo === null || expandedTo === "/" || expandedTo === "") {
      return NextResponse.json(
        { error: "Invalid destination path" },
        { status: 400 }
      );
    }
    to = expandedTo;
    if (op === "move" || op === "copy" || op === "copyDir") {
      // For move/copy/copyDir, "to" is a destination directory and the
      // source basename is joined onto it.
      if (!existsSync(to)) {
        return NextResponse.json(
          { error: "Destination directory does not exist" },
          { status: 404 }
        );
      }
      if (!statSync(to).isDirectory()) {
        return NextResponse.json(
          { error: "Destination must be a directory" },
          { status: 400 }
        );
      }
      to = resolve(to, basename(path));
      // A destination inside the source (moving a directory into its own
      // descendant, or onto itself) would truncate or corrupt the tree.
      // Linux rename reports a bare EINVAL/ENOTEMPTY as a 500; reject cleanly.
      if (isInside(path, to)) {
        return NextResponse.json(
          {
            error:
              "Destination is inside the source: cannot move into itself or a descendant",
          },
          { status: 400 }
        );
      }
    }
  }

  try {
    if (op === "mkdir") {
      mkdirSync(path, { recursive: true });
      return NextResponse.json({ ok: true });
    }

    if (op === "createFile") {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "", { flag: "wx" });
      return NextResponse.json({ ok: true });
    }

    if (op === "rename") {
      try {
        statSync(path);
      } catch {
        return NextResponse.json(
          { error: "Source path does not exist" },
          { status: 404 }
        );
      }
      if (isInside(path, to!)) {
        return NextResponse.json(
          { error: "Destination is inside the source path" },
          { status: 400 }
        );
      }
      if (!force && existsSync(to!)) {
        return NextResponse.json(
          { error: "Destination already exists" },
          { status: 409 }
        );
      }
      renameAcrossDevices(path, to!);
      return NextResponse.json({ ok: true });
    }

    if (op === "move") {
      try {
        statSync(path);
      } catch {
        return NextResponse.json(
          { error: "Source path does not exist" },
          { status: 404 }
        );
      }
      if (!force && existsSync(to!)) {
        return NextResponse.json(
          { error: "Destination already exists" },
          { status: 409 }
        );
      }
      renameAcrossDevices(path, to!);
      return NextResponse.json({ ok: true });
    }

    if (op === "copy") {
      const srcStat = (() => {
        try {
          return statSync(path);
        } catch {
          return null;
        }
      })();
      if (!srcStat) {
        return NextResponse.json(
          { error: "Source path does not exist" },
          { status: 404 }
        );
      }
      if (!srcStat.isFile()) {
        return NextResponse.json(
          { error: "copy of folders not supported" },
          { status: 400 }
        );
      }
      if (!force && existsSync(to!)) {
        return NextResponse.json(
          { error: "Destination already exists" },
          { status: 409 }
        );
      }
      copyFileSync(path, to!);
      return NextResponse.json({ ok: true });
    }

    if (op === "restore") {
      const meta = readTrashMeta(path);
      if (!meta) {
        return NextResponse.json(
          { error: "No trash metadata found for this path" },
          { status: 400 }
        );
      }
      const target = to ?? meta.origPath;
      if (!force && existsSync(target)) {
        return NextResponse.json(
          { error: "Original path already exists" },
          { status: 409 }
        );
      }
      mkdirSync(dirname(target), { recursive: true });
      renameAcrossDevices(path, target);
      rmSync(metaPathFor(path), { force: true });
      return NextResponse.json({ ok: true, restoredTo: target });
    }

    if (op === "copyDir") {
      const srcStat = (() => {
        try {
          return statSync(path);
        } catch {
          return null;
        }
      })();
      if (!srcStat) {
        return NextResponse.json(
          { error: "Source path does not exist" },
          { status: 404 }
        );
      }
      if (!srcStat.isDirectory()) {
        return NextResponse.json(
          { error: "copyDir requires a directory source" },
          { status: 400 }
        );
      }
      if (!force && existsSync(to!)) {
        return NextResponse.json(
          { error: "Destination already exists" },
          { status: 409 }
        );
      }
      if (to === path || to!.startsWith(path + "/")) {
        return NextResponse.json(
          { error: "Cannot copy a directory into itself" },
          { status: 400 }
        );
      }
      copyDirRecursive(path, to!, 0, { bytes: 0 });
      return NextResponse.json({ ok: true });
    }

    if (op === "purge") {
      // purge: permanently remove a trashed item. Contained to the trash
      // directory itself: without this, any path the client can name (the
      // whole filesystem for this app) could be recursively destroyed by a
      // single payload. Only direct children of TRASH_DIR qualify.
      if (dirname(path) !== TRASH_DIR || path === TRASH_DIR) {
        return NextResponse.json(
          { error: "purge only accepts paths inside the trash directory" },
          { status: 400 }
        );
      }
      try {
        statSync(path);
      } catch {
        return NextResponse.json(
          { error: "Path does not exist" },
          { status: 404 }
        );
      }
      rmSync(path, { recursive: true, force: false });
      rmSync(metaPathFor(path), { force: true });
      return NextResponse.json({ ok: true });
    }

    // delete: soft delete -> move into the trash directory instead of removal
    try {
      statSync(path);
    } catch {
      return NextResponse.json(
        { error: "Path does not exist" },
        { status: 404 }
      );
    }
    mkdirSync(TRASH_DIR, { recursive: true });
    // Reserve the slot (metadata first) so the recorded original path always
    // belongs to this item, then release the reservation if the move fails:
    // metadata for an item that never arrived would strand the trash entry and
    // make a later delete of the same name inherit the wrong original path.
    const trashPath = reserveTrashSlot(path);
    try {
      renameAcrossDevices(path, trashPath);
    } catch (moveError) {
      rmSync(metaPathFor(trashPath), { force: true });
      throw moveError;
    }
    return NextResponse.json({ ok: true, trashPath });
  } catch (error) {
    console.error(`File op ${op} failed:`, error);
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      return NextResponse.json({ error: "Path not found" }, { status: 404 });
    }
    if (code === "EEXIST") {
      return NextResponse.json(
        { error: "Target already exists" },
        { status: 409 }
      );
    }
    if (code === "EACCES" || code === "EPERM") {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }
    if (code === "ECOPYDEPTH") {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
    if (code === "ECOPYBYTES") {
      return NextResponse.json({ error: (error as Error).message }, { status: 413 });
    }
    return NextResponse.json(
      { error: "Operation failed" },
      { status: 500 }
    );
  }
}

function existsSync(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** True when `candidate` is `parent` itself or a path inside it. */
function isInside(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(parent + "/");
}
