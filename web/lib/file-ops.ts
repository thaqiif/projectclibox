/**
 * Client helpers for file operations (POST /api/files/ops)
 */

export interface FileOpResponse {
  ok?: boolean;
  error?: string;
}

type FileOp =
  | "mkdir"
  | "createFile"
  | "rename"
  | "move"
  | "copy"
  | "copyDir"
  | "delete"
  | "restore"
  | "purge";

export interface FileDeleteResponse extends FileOpResponse {
  /** Location the deleted item was moved to inside the trash directory. */
  trashPath?: string;
}

export interface FileRestoreResponse extends FileOpResponse {
  /** Path the item was restored to (original location or override). */
  restoredTo?: string;
}

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

/** Move a file or directory into a destination directory (keeps its basename). Pass force: true to overwrite dest. */
export function fileMove(
  path: string,
  toDir: string,
  options: FileOpOptions = {}
): Promise<FileOpResponse> {
  return fileOp("move", path, { to: toDir, force: options.force });
}

/** Copy a file (or directory when supported) into a destination directory (keeps its basename). Pass force: true to overwrite dest. */
export function fileCopy(
  path: string,
  toDir: string,
  options: FileOpOptions = {}
): Promise<FileOpResponse> {
  return fileOp("copy", path, { to: toDir, force: options.force });
}

/**
 * Recursively copy a DIRECTORY into a destination directory (keeps its
 * basename). Caps on the server: depth 20, 200MB total, symlinks skipped.
 */
export function fileCopyDir(
  path: string,
  toDir: string,
  options: FileOpOptions = {}
): Promise<FileOpResponse> {
  return fileOp("copyDir", path, { to: toDir, force: options.force });
}

/**
 * Soft-delete a file or directory (recursive): it is moved into the server's
 * trash directory (~/.clibox/.trash) with a collision-safe timestamped name.
 * Returns { ok, trashPath } so callers can offer Undo via fileRestore.
 */
export function fileDelete(path: string): Promise<FileDeleteResponse> {
  return fileOp("delete", path) as Promise<FileDeleteResponse>;
}

/**
 * Restore a trashed item back to its original location (or `toDir` override,
 * treated as the destination directory). 409 if the target already exists.
 */
export function fileRestore(
  trashPath: string,
  toDir?: string
): Promise<FileRestoreResponse> {
  return fileOp("restore", trashPath, {
    to: toDir,
  }) as Promise<FileRestoreResponse>;
}

/** Permanently delete a trashed item and its metadata file. */
export function filePurge(trashPath: string): Promise<FileOpResponse> {
  return fileOp("purge", trashPath);
}
