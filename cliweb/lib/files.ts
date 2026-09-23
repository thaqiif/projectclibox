/**
 * File system utilities for file explorer (server-only)
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, extname } from "path";

// Re-export client-safe types and utilities
import type { FileNode } from "./file-utils";

/**
 * Default exclude patterns (matches common ignore patterns)
 */
const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".vercel",
  ".turbo",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".venv",
  "venv",
  ".DS_Store",
  "*.log",
  ".env",
  ".env.local",
  ".env.*.local",
  "*.db",
  "*.db-wal",
  "*.db-shm",
];

/**
 * Check if a file/directory should be excluded
 */
function shouldExclude(name: string, excludePatterns: string[]): boolean {
  return excludePatterns.some((pattern) => {
    if (pattern.includes("*")) {
      // Simple glob pattern matching
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(name);
    }
    return name === pattern;
  });
}

/**
 * List directory contents with exclusions
 */
export function listDirectory(
  dirPath: string,
  options: {
    excludePatterns?: string[];
    recursive?: boolean;
    maxDepth?: number;
    currentDepth?: number;
    showHidden?: boolean;
  } = {}
): FileNode[] {
  const {
    excludePatterns = DEFAULT_EXCLUDES,
    recursive = false,
    maxDepth = 3,
    currentDepth = 0,
    showHidden = false,
  } = options;

  try {
    const entries = readdirSync(dirPath);
    const nodes: FileNode[] = [];

    for (const entry of entries) {
      const isHiddenDotEntry = entry.startsWith(".") && entry !== "." && entry !== "..";

      // Skip excluded files; with showHidden, dotfiles (including .git etc.)
      // bypass exclusion so they are visible.
      if (!showHidden || !isHiddenDotEntry) {
        if (shouldExclude(entry, excludePatterns)) {
          continue;
        }
      }

      const fullPath = join(dirPath, entry);
      let stat;

      try {
        stat = statSync(fullPath);
      } catch {
        // Permission denied or other error, skip
        continue;
      }

      const isDir = stat.isDirectory();
      const node: FileNode = {
        name: entry,
        path: fullPath,
        type: isDir ? "directory" : "file",
      };

      if (!isDir) {
        node.size = stat.size;
        node.extension = extname(entry).slice(1); // Remove leading dot
      }

      // Recursively load children if requested and not at max depth
      if (isDir && recursive && currentDepth < maxDepth) {
        node.children = listDirectory(fullPath, {
          excludePatterns,
          recursive: true,
          maxDepth,
          currentDepth: currentDepth + 1,
          showHidden,
        });
      }

      nodes.push(node);
    }

    // Sort: directories first, then files, alphabetically within each group
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error(`Failed to list directory ${dirPath}:`, error);
    return [];
  }
}

/**
 * Read file contents with encoding detection
 */
/**
 * Default read limit: 2MB.
 *
 * Files larger than this are never returned as editable text: the response
 * is flagged isBinary:true with content set to a size note. ANY response
 * flagged like that must never be POSTed back to /api/files/content, or a
 * placeholder string would overwrite the real file on disk.
 */
const DEFAULT_MAX_READ_BYTES = 2 * 1024 * 1024;

/**
 * Read only the first slice when sniffing for binary content. A video or
 * archive has a null byte near the start long before 8KB; text files
 * almost never do (the one exception, UTF-16 content, also begins with a
 * BOM or null byte and is not editable as UTF-8 text anyway).
 */
const BINARY_SNIFF_BYTES = 8 * 1024;

export function readFileContent(
  filePath: string,
  options: { maxSize?: number } = {}
): { content: string; isBinary: boolean; truncated: boolean; size: number } {
  const { maxSize = DEFAULT_MAX_READ_BYTES } = options;

  try {
    const stat = statSync(filePath);

    // Oversized files: NEVER reports isBinary:false. A truncated read
    // cannot be saved back without losing the tail (or, worse, a naive
    // client treating the size note as document content and destroying the
    // original file), so it is refused on the client and, defense in depth,
    // again on the server.
    if (stat.size > maxSize) {
      return {
        content: `File too large (${(stat.size / 1024 / 1024).toFixed(2)}MB). Maximum size: ${(maxSize / 1024 / 1024).toFixed(2)}MB`,
        isBinary: true,
        truncated: true,
        size: stat.size,
      };
    }

    const buffer = readFileSync(filePath);

    // Null bytes in the sniff window mean binary. Also flagged when the
    // full-content check later hits a tail null, so no file whose bytes are
    // not exactly reproducible as text is EVER handed back as savable text.
    const headIsBinary = buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
    const tailHasNull = !headIsBinary && buffer.includes(0);

    if (headIsBinary || tailHasNull) {
      return {
        content: `Binary file (${(stat.size / 1024).toFixed(2)}KB)`,
        isBinary: true,
        truncated: false,
        size: stat.size,
      };
    }

    return {
      content: buffer.toString("utf-8"),
      isBinary: false,
      truncated: false,
      size: stat.size,
    };
  } catch (error) {
    throw new Error(
      `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Write content to a file.
 *
 * Safety guard: refuses to overwrite a file whose CURRENT on-disk content
 * is binary (null byte within the first 8KB) with text. This is the last
 * line of defense against a client that opened a binary file, received a
 * placeholder string, and saved it back, destroying the original bytes
 * (this exact flow destroyed a 34MB video once). The conflict/overwrite
 * confirmation flow may pass { allowBinaryOverwrite: true } to bypass the
 * guard after an explicit user confirmation.
 */
export function writeFileContent(
  filePath: string,
  content: string,
  options: { maxSize?: number; allowBinaryOverwrite?: boolean } = {}
): { success: boolean; size: number } {
  const { maxSize = 1024 * 1024, allowBinaryOverwrite = false } = options;

  const contentBuffer = Buffer.from(content, "utf-8");

  if (contentBuffer.length > maxSize) {
    throw new Error(
      `Content too large (${(contentBuffer.length / 1024 / 1024).toFixed(2)}MB). Maximum size: ${(maxSize / 1024 / 1024).toFixed(2)}MB`
    );
  }

  // Sniff the CURRENT file, before any write. Missing file = nothing to
  // protect (new file creation). Read errors other than missing are
  // surfaced: failing closed is the safe default for a data-destruction
  // guard.
  let existing: Buffer | null = null;
  try {
    existing = readFileSync(filePath);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    if (code !== "ENOENT") {
      throw new Error(
        `Failed to write file: cannot verify existing file (${
          error instanceof Error ? error.message : "Unknown error"
        })`
      );
    }
  }

  if (
    existing !== null &&
    !allowBinaryOverwrite &&
    existing.subarray(0, BINARY_SNIFF_BYTES).includes(0)
  ) {
    throw new Error("refusing to overwrite binary file with text");
  }

  try {
    writeFileSync(filePath, content, "utf-8");
    return {
      success: true,
      size: contentBuffer.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to write file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
