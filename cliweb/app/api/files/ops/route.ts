import { NextRequest, NextResponse } from "next/server";
import {
  copyFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  statSync,
  readFileSync,
} from "fs";
import { resolve, dirname, basename, join } from "path";
import { guardJsonSameOrigin } from "@/lib/route-guards";

/**
 * Trash directory for "soft" deletes: deleted items are moved here instead of
 * being permanently removed, together with a <name>.meta.json sibling that
 * records the original absolute path so they can be restored.
 */
const TRASH_DIR = join(process.env.HOME || "", ".cliweb-trash");

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
 * Pick a unique trash name for `origPath`: original basename, then
 * "name.<timestamp>", "name.<timestamp>-1", ... until a free slot is found.
 */
function uniqueTrashPath(origPath: string): string {
  const base = basename(origPath);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "");
  let candidate = join(TRASH_DIR, `${base}.${stamp}`);
  for (let n = 0; existsSync(candidate); n++) {
    candidate = join(TRASH_DIR, `${base}.${stamp}-${n}`);
  }
  return candidate;
}

/**
 * POST /api/files/ops
 * JSON body: { op: "mkdir" | "createFile" | "rename" | "move" | "copy" | "delete" | "restore" | "purge", path: string, to?: string, force?: boolean }
 *
 * delete: move the target into ~/.cliweb-trash/ (soft delete, returns trashPath).
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
    !["mkdir", "createFile", "rename", "move", "copy", "delete", "restore", "purge"].includes(op)
  ) {
    return NextResponse.json(
      { error: `Unsupported op: ${op}` },
      { status: 400 }
    );
  }

  // Expand ~ to home directory, consistent with the other file routes
  const expand = (p: string) =>
    resolve(p.replace(/^~/, process.env.HOME || ""));

  const path = expand(rawPath);

  // Reject traversal: after resolve, any ".." segment means it escaped
  if (path.split("/").includes("..")) {
    return NextResponse.json(
      { error: "Path traversal is not allowed" },
      { status: 400 }
    );
  }

  // Reject "." / root "/" as target
  if (path === "." || path === "/" || path === "") {
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
    (op === "restore" && rawTo !== undefined)
  ) {
    if (!rawTo) {
      return NextResponse.json(
        { error: `to is required for ${op}` },
        { status: 400 }
      );
    }
    to = expand(rawTo);
    if (to.split("/").includes("..") || to === "." || to === "/" || to === "") {
      return NextResponse.json(
        { error: "Invalid destination path" },
        { status: 400 }
      );
    }
    if (op === "move" || op === "copy") {
      // For move/copy, "to" is a destination directory and the source
      // basename is joined onto it.
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
      if (!force && existsSync(to!)) {
        return NextResponse.json(
          { error: "Destination already exists" },
          { status: 409 }
        );
      }
      renameSync(path, to!);
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
      renameSync(path, to!);
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
      renameSync(path, target);
      rmSync(metaPathFor(path), { force: true });
      return NextResponse.json({ ok: true, restoredTo: target });
    }

    // purge: permanently remove a trashed item (used by empty-trash later)
    try {
      statSync(path);
    } catch {
      return NextResponse.json({ error: "Path does not exist" }, { status: 404 });
    }
    rmSync(path, { recursive: true, force: false });
    rmSync(metaPathFor(path), { force: true });
    return NextResponse.json({ ok: true });

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
    const trashPath = uniqueTrashPath(path);
    renameSync(path, trashPath);
    const meta: TrashMeta = {
      origPath: path,
      trashPath,
      deletedAt: new Date().toISOString(),
    };
    try {
      writeTrashMeta(meta);
    } catch (metaErr) {
      console.error("Failed to write trash meta:", metaErr);
      // Item is already trashed; report success but flag the missing meta
      return NextResponse.json({ ok: true, trashPath, metaError: true });
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
