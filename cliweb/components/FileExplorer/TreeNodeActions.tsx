"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Loader2, ArrowUp, Folder } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  fileMkdir,
  fileCreate,
  fileRename,
  fileMove,
  fileCopy,
  fileDelete,
} from "@/lib/file-ops";
import type { FileNode } from "@/lib/file-utils";

interface FileOpsMenuProps {
  node: FileNode;
  workingDirectory: string;
  onDone?: () => void;
}

interface DirPickState {
  mode: "move" | "copy";
  currentDir: string;
  entries: FileNode[];
  loading: boolean;
  error?: string;
}

async function listDirs(path: string): Promise<{ files: FileNode[]; path: string }> {
  const res = await fetch(
    `/api/files?path=${encodeURIComponent(path)}&showHidden=false`
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to list directory (${res.status})`);
  }
  return res.json();
}

const parentDir = (dir: string) =>
  dir.replace(/\/+$/, "").slice(0, dir.replace(/\/+$/, "").lastIndexOf("/")) || "/";

/**
 * Per-node "..." action menu: New Folder / New File (only on directories),
 * Rename, Move, Copy, Delete. Wraps POST /api/files/ops via lib/file-ops helpers.
 * Intentionally self-contained: the team wires it into ListingBody.
 */
export function FileOpsMenu({ node, workingDirectory, onDone }: FileOpsMenuProps) {
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<DirPickState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContentRef = useRef<HTMLDivElement | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onDone?.();
    } catch (err) {
      console.error("File op failed:", err);
      alert(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  };

  const joinPath = (dir: string, name: string) =>
    `${dir.replace(/\/+$/, "")}/${name}`;

  const handleNewFolder = () => {
    const name = prompt("New folder name:");
    if (!name) return;
    run(() => fileMkdir(joinPath(node.type === "directory" ? node.path : workingDirectory, name)));
  };

  const handleNewFile = () => {
    const name = prompt("New file name:");
    if (!name) return;
    run(() => fileCreate(joinPath(node.type === "directory" ? node.path : workingDirectory, name)));
  };

  const handleRename = () => {
    const name = prompt("New name:", node.name);
    if (!name || name === node.name) return;
    const parent = node.path.slice(0, node.path.lastIndexOf("/")) || "/";
    run(() => fileRename(node.path, joinPath(parent, name)));
  };

  const openPicker = useCallback(async (mode: "move" | "copy") => {
    const start = workingDirectory || parentDir(node.path);
    setPicker({ mode, currentDir: start, entries: [], loading: true });
    try {
      const { files } = await listDirs(start);
      setPicker((prev) =>
        prev ? { ...prev, entries: files.filter((f) => f.type === "directory"), loading: false } : prev
      );
    } catch (err) {
      setPicker((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: err instanceof Error ? err.message : "Failed to list",
            }
          : prev
      );
    }
  }, [workingDirectory, node.path]);

  const drillDown = async (dir: string) => {
    if (!picker) return;
    setPicker({ ...picker, currentDir: dir, entries: [], loading: true, error: undefined });
    try {
      const { files } = await listDirs(dir);
      setPicker((prev) =>
        prev ? { ...prev, entries: files.filter((f) => f.type === "directory"), loading: false } : prev
      );
    } catch (err) {
      setPicker((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: err instanceof Error ? err.message : "Failed to list",
            }
          : prev
      );
    }
  };

  const confirmPick = () => {
    if (!picker) return;
    const { mode, currentDir } = picker;
    setPicker(null);
    // Refuse moving a directory into itself or its own subtree
    if (
      node.type === "directory" &&
      (currentDir === node.path || currentDir.startsWith(node.path.replace(/\/+$/, "") + "/"))
    ) {
      alert(`Cannot ${mode} "${node.name}" into itself or its own subtree`);
      return;
    }
    run(() => (mode === "move" ? fileMove(node.path, currentDir) : fileCopy(node.path, currentDir)));
  };

  const handleDelete = () => {
    if (!confirm(`Delete "${node.name}"${node.type === "directory" ? " (and all contents)" : ""}? This cannot be undone.`)) {
      return;
    }
    run(() => fileDelete(node.path));
  };

  // Scroll the dropdown content to bottom when the picker section appears
  useEffect(() => {
    if (picker && menuContentRef.current) {
      menuContentRef.current.scrollTo({ top: menuContentRef.current.scrollHeight });
    }
  }, [picker?.loading, picker?.entries.length]);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={(open) => { setMenuOpen(open); if (!open) setPicker(null); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${node.name}`}
          disabled={busy}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover/node:opacity-100 data-[state=open]:opacity-100"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MoreHorizontal className="h-3.5 w-3.5" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {node.type === "directory" && (
          <>
            <DropdownMenuItem onClick={handleNewFolder}>New Folder</DropdownMenuItem>
            <DropdownMenuItem onClick={handleNewFile}>New File</DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onClick={handleRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPicker("move")}>Move...</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPicker("copy")}>Copy...</DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleDelete}
          className={cn("text-destructive focus:text-destructive")}
        >
          Delete
        </DropdownMenuItem>

        {picker && (
          <div
            className="mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-background/95 p-1"
            ref={menuContentRef}
          >
            <div className="flex items-center justify-between gap-1 px-1 py-0.5">
              <span className="truncate text-[11px] font-medium text-muted-foreground" title={picker.currentDir}>
                {picker.mode === "move" ? "Move to" : "Copy to"}: {picker.currentDir}
              </span>
              <button
                type="button"
                className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-[11px] hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  drillDown(parentDir(picker.currentDir));
                }}
              >
                <ArrowUp className="h-3 w-3" /> Up
              </button>
            </div>
            <div
              role="button"
              tabIndex={0}
              className="w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                confirmPick();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  confirmPick();
                }
              }}
            >
              ✓ Choose this directory
            </div>
            {picker.loading && (
              <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading...
              </div>
            )}
            {picker.error && (
              <div className="px-2 py-1 text-xs text-destructive">{picker.error}</div>
            )}
            {!picker.loading && picker.entries.length === 0 && !picker.error && (
              <div className="px-2 py-1 text-xs text-muted-foreground">No subdirectories</div>
            )}
            {picker.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  drillDown(entry.path);
                }}
              >
                <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
