/**
 * Client helpers for file operations (POST /api/files/ops)
 */

export interface FileOpResponse {
  ok?: boolean;
  error?: string;
}

type FileOp = "mkdir" | "createFile" | "rename" | "delete";

interface FileOpOptions {
  force?: boolean;
}

async function fileOp(
  op: FileOp,
  path: string,
  options: { to?: string; force?: boolean } = {}
): Promise<FileOpResponse> {
  const res = await fetch("/api/files/ops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, path, to: options.to, force: options.force }),
  });

  let data: Partial<FileOpResponse> = {};
  try {
    data = await res.json();
  } catch {
    // fallthrough with empty data
  }

  if (!res.ok) {
    throw new Error(data.error || `File operation failed (${res.status})`);
  }

  return data as FileOpResponse;
}

/** Create a directory (recursive, like mkdir -p). */
export function fileMkdir(path: string): Promise<FileOpResponse> {
  return fileOp("mkdir", path);
}

/** Create an empty file (fails if it already exists). */
export function fileCreate(path: string): Promise<FileOpResponse> {
  return fileOp("createFile", path);
}

/** Rename / move a file or directory. Pass force: true to overwrite dest. */
export function fileRename(
  path: string,
  to: string,
  options: FileOpOptions = {}
): Promise<FileOpResponse> {
  return fileOp("rename", path, { to, force: options.force });
}

/** Delete a file or directory (recursive). */
export function fileDelete(path: string): Promise<FileOpResponse> {
  return fileOp("delete", path);
}
