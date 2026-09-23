import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, renameSync, rmSync, writeFileSync, statSync } from "fs";
import { resolve, dirname } from "path";

/**
 * POST /api/files/ops
 * JSON body: { op: "mkdir" | "createFile" | "rename" | "delete", path: string, to?: string, force?: boolean }
 */
export async function POST(request: NextRequest) {
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

  if (!["mkdir", "createFile", "rename", "delete"].includes(op)) {
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
  if (op === "rename") {
    if (!rawTo) {
      return NextResponse.json(
        { error: "to is required for rename" },
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

    // delete
    try {
      statSync(path);
    } catch {
      return NextResponse.json(
        { error: "Path does not exist" },
        { status: 404 }
      );
    }
    rmSync(path, { recursive: true, force: false });
    return NextResponse.json({ ok: true });
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
