"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MoreHorizontal,
  Loader2,
  ArrowUp,
  Folder,
  Undo2,
  X,
  Trash2,
} from "lucide-react";
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
  fileRestore,
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

/** Pending trashed item shown in the undo banner. */
interface TrashUndoState {
  name: string;
  trashPath: string;
  expiresAt: number;
}

/** Window during which Undo is offered after a trash delete. */
const UNDO_WINDOW_MS = 10_000;

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
  const [trashUndo, setTrashUndo] = useState<TrashUndoState | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const trashUndoRef = useRef<TrashUndoState | null>(null);
  trashUndoRef.current = trashUndo;
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

  const handleTrashDelete = () => {
    if (
      !confirm(
        `Move "${node.name}"${node.type === "directory" ? " (and all contents)" : ""} to trash? It will be removed permanently after the undo window.`
      )
    ) {
      return;
    }
    run(async () => {
      const res = await fileDelete(node.path);
      if (!res.trashPath) return;
      setMenuOpen(false);
      setTrashUndo({
        name: node.name,
        trashPath: res.trashPath,
        expiresAt: Date.now() + UNDO_WINDOW_MS,
      });
    });
  };

  const dismissTrashUndo = useCallback(() => setTrashUndo(null), []);

  const handleUndoDelete = async () => {
    if (!trashUndo || undoBusy) return;
    setUndoBusy(true);
    try {
      await fileRestore(trashUndo.trashPath);
      setTrashUndo(null);
      onDone?.(); // restore re-adds the item, so refresh the parent list
    } catch (err) {
      console.error("Restore failed:", err);
      alert(
        err instanceof Error
          ? err.message
          : "Restore failed; the item stays in trash"
      );
    } finally {
      setUndoBusy(false);
    }
  };

  // Auto-dismiss the banner when the undo window elapses
  useEffect(() => {
    if (!trashUndo) return;
    const tick = () => {
      if (Date.now() >= (trashUndoRef.current?.expiresAt ?? 0)) {
        setTrashUndo(null);
      }
    };
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [trashUndo]);

  const handleDownloadZip = () => {
    const url = `/api/files/zip?path=${encodeURIComponent(node.path)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${node.name}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
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
            <DropdownMenuItem onClick={handleDownloadZip}>Download as zip</DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onClick={handleRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPicker("move")}>Move...</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPicker("copy")}>Copy...</DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleTrashDelete}
          className={cn("text-destructive focus:text-destructive")}
        >
          <Trash2 className="h-3.5 w-3.5" /> Move to Trash
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
      {trashUndo &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur"
          >
            <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="max-w-[40ch] truncate text-sm">
              Moved "{trashUndo.name}" to trash
            </span>
            <button
              type="button"
              disabled={undoBusy}
              onClick={() => void handleUndoDelete()}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {undoBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Undo2 className="h-3 w-3" />
              )}
              Undo
            </button>
            <button
              type="button"
              aria-label="Dismiss undo banner"
              onClick={dismissTrashUndo}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>,
          document.body
        )}
    </DropdownMenu>
  );
}
