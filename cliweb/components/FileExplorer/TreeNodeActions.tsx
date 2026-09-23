"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MoreHorizontal,
  Loader2,
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
import { DirPickerDialog } from "./DirPickerDialog";
import type { FileNode } from "@/lib/file-utils";

interface FileOpsMenuProps {
  node: FileNode;
  workingDirectory: string;
  onDone?: () => void;
}

/** Pending trashed item shown in the undo banner. */
interface TrashUndoState {
  name: string;
  trashPath: string;
  expiresAt: number;
}

/** Window during which Undo is offered after a trash delete. */
const UNDO_WINDOW_MS = 10_000;

/**
 * Per-node "..." action menu: New Folder / New File (only on directories),
 * Rename, Move, Copy, Delete. Wraps POST /api/files/ops via lib/file-ops helpers.
 * Move/Copy open the shared DirPickerDialog OUTSIDE the dropdown: Radix
 * unmounts DropdownMenuContent when a menu item is clicked, so any picker
 * rendered inside it was destroyed before it could show (the "nothing
 * happens" bug). A portal dialog survives the menu close.
 */
export function FileOpsMenu({ node, workingDirectory, onDone }: FileOpsMenuProps) {
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<{ mode: "move" | "copy" } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [trashUndo, setTrashUndo] = useState<TrashUndoState | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const trashUndoRef = useRef<TrashUndoState | null>(null);
  trashUndoRef.current = trashUndo;

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

  const openPicker = (mode: "move" | "copy") => {
    setMenuOpen(false); // close the menu; the dialog is portaled and survives
    setPicker({ mode });
  };

  const confirmPick = (currentDir: string) => {
    if (!picker) return;
    const { mode } = picker;
    setPicker(null);
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

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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
          <DropdownMenuItem onSelect={() => openPicker("move")}>Move...</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openPicker("copy")}>Copy...</DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleTrashDelete}
            className={cn("text-destructive focus:text-destructive")}
          >
            <Trash2 className="h-3.5 w-3.5" /> Move to Trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Portaled dialog: independent of the dropdown lifecycle. */}
      <DirPickerDialog
        open={picker !== null}
        mode={picker?.mode ?? "move"}
        itemLabel={node.name}
        startDir={workingDirectory || node.path.slice(0, node.path.lastIndexOf("/")) || "/"}
        blockedDirs={node.type === "directory" ? [node.path] : undefined}
        busy={busy}
        onChoose={confirmPick}
        onCancel={() => setPicker(null)}
      />

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
    </>
  );
}
