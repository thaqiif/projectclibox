/**
 * Multi-select model helpers and bulk file operations for the file listing.
 * Pure functions: no React, no DOM. Selection is a plain Set<string> of paths.
 * The listing (ListingBody in FileExplorer/index.tsx) wires these into its
 * rows; BulkActionBar consumes the selection and calls the bulk op helpers.
 */
import { fileDelete, fileMove, fileCopy, fileCopyDir } from "./file-ops";

/** Result of a per-item loop: successes by path, failures with error text. */
export interface BulkOpResult {
  succeeded: string[];
  failed: { path: string; error: string }[];
}

/** Add a path to the selection (returns a new Set). */
export function addToSelection(
  selected: ReadonlySet<string>,
  path: string
): Set<string> {
  const next = new Set(selected);
  next.add(path);
  return next;
}

/** Remove a path from the selection (returns a new Set). */
export function removeFromSelection(
  selected: ReadonlySet<string>,
  path: string
): Set<string> {
  const next = new Set(selected);
  next.delete(path);
  return next;
}

/** Toggle one path in the selection (checkbox / ctrl+click behaviour). */
export function toggleSelection(
  selected: ReadonlySet<string>,
  path: string
): Set<string> {
  const next = new Set(selected);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  return next;
}

/** Select every listed path. */
export function selectAll(paths: readonly string[]): Set<string> {
  return new Set(paths);
}

/** Clear the selection. */
export function clearSelection(): Set<string> {
  return new Set();
}

/**
 * Run one op per path, collecting per-item failures instead of throwing on
 * the first error, so a single bad path does not abort the whole batch.
 */
async function runBulk(
  paths: readonly string[],
  op: (path: string) => Promise<unknown>
): Promise<BulkOpResult> {
  const succeeded: string[] = [];
  const failed: { path: string; error: string }[] = [];
  for (const path of paths) {
    try {
      await op(path);
      succeeded.push(path);
    } catch (err) {
      failed.push({
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { succeeded, failed };
}

/** Soft-delete every selected path (trash, undoable on the server side). */
export function bulkDelete(paths: readonly string[]): Promise<BulkOpResult> {
  return runBulk(paths, (path) => fileDelete(path));
}

/**
 * Move every selected path into destination directory `toDir`.
 * No blanket subtree pre-check is applied here: the only destination the UI
 * forbids is the directory the listing was made from, and real cycle errors
 * (a selected directory moved into itself or a descendant) are caught per
 * item by the server, so a single bad path stays a single failed item.
 */
export function bulkMove(
  paths: readonly string[],
  toDir: string
): Promise<BulkOpResult> {
  return runBulk(paths, (path) => fileMove(path, toDir));
}

/**
 * Copy every selected path into destination directory `toDir`. Plain `copy`
 * op handles files; when the server reports the source is a folder (copy of
 * folders not supported) the item falls back to the recursive copyDir op so
 * copying a mixed selection succeeds item by item.
 */
export async function bulkCopy(
  paths: readonly string[],
  toDir: string
): Promise<BulkOpResult> {
  return runBulk(paths, async (path) => {
    try {
      await fileCopy(path, toDir);
    } catch (err) {
      if (
        err instanceof Error &&
        /copy of folders not supported/i.test(err.message)
      ) {
        await fileCopyDir(path, toDir);
        return;
      }
      throw err;
    }
  });
}

/** Human-readable summary for a toast/alert after a bulk operation. */
export function summarizeBulkResult(
  verb: string,
  result: BulkOpResult
): string | null {
  const { succeeded, failed } = result;
  if (failed.length === 0) {
    return succeeded.length > 0
      ? `${verb} ${succeeded.length} item${succeeded.length === 1 ? "" : "s"}`
      : null;
  }
  const parts = [
    `${verb} ${succeeded.length} item${succeeded.length === 1 ? "" : "s"}`,
    `${failed.length} failed:`,
    ...failed.slice(0, 5).map((f) => `${f.path}: ${f.error}`),
  ];
  if (failed.length > 5) parts.push(`...and ${failed.length - 5} more`);
  return parts.join("\n");
}
