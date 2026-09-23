"use client";

/**
 * Directory picker Dialog used by Move/Copy flows (single node and bulk).
 * Extracted from the ill-fated inline picker that used to live inside
 * DropdownMenuContent: Radix closes the menu on item click and unmounts it,
 * so any picker state rendered there was destroyed before it could show.
 * A Dialog portals to <body>, independent of the menu, and is the reliable
 * pattern here.
 */
import { useEffect, useState } from "react";
import { ArrowUp, Folder, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { FileNode } from "@/lib/file-utils";

export interface DirPickerDialogProps {
  open: boolean;
  /** Action label: "Move" or "Copy". */
  mode: "move" | "copy";
  /** Human label for the thing being acted on, e.g. "notes.txt" or "3 items". */
  itemLabel: string;
  /** Directory the browsing starts from (usually the current working dir). */
  startDir: string;
  /**
   * Directories that may not be picked, nor any of their subdirectories
   * (e.g. the source dirs when moving a directory). Optional.
   */
  blockedDirs?: readonly string[];
  /** Disable Choose while the resulting operation is in flight. */
  busy?: boolean;
  onChoose: (dir: string) => void;
  onCancel: () => void;
}

async function listDirs(path: string): Promise<{ files: FileNode[] }> {
  const res = await fetch(
    `/api/files?path=${encodeURIComponent(path)}&showHidden=false`
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to list directory (${res.status})`);
  }
  return res.json();
}

const normDir = (dir: string) => dir.replace(/\/+$/, "") || "/";

const parentDir = (dir: string) =>
  dir.replace(/\/+$/, "").slice(0, dir.replace(/\/+$/, "").lastIndexOf("/")) || "/";

export function DirPickerDialog({
  open,
  mode,
  itemLabel,
  startDir,
  blockedDirs,
  busy = false,
  onChoose,
  onCancel,
}: DirPickerDialogProps) {
  const [currentDir, setCurrentDir] = useState(startDir);
  const [entries, setEntries] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to the start directory each time the dialog opens.
  useEffect(() => {
    if (open) setCurrentDir(startDir);
  }, [open, startDir]);

  // (Re)load the listing whenever the current directory changes while open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntries([]);
    const load = async () => {
      try {
        const { files } = await listDirs(currentDir);
        if (cancelled) return;
        setEntries(files.filter((f) => f.type === "directory"));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to list");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, currentDir]);

  // Refuse blocked directories and their subtrees (moving a dir into itself).
  const isBlocked =
    blockedDirs !== undefined &&
    blockedDirs.some(
      (b) =>
        normDir(currentDir) === normDir(b) ||
        normDir(currentDir).startsWith(normDir(b) + "/")
    );

  const chooseDisabled = loading || busy || isBlocked;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "move" ? "Move" : "Copy"} &ldquo;{itemLabel}&rdquo;
          </DialogTitle>
          <DialogDescription>
            Pick the destination directory
            {mode === "copy" ? " (a copy is made)" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-background">
          <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
              title={currentDir}
            >
              {currentDir}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 gap-0.5 px-2 text-xs"
              disabled={currentDir === "/" || loading || busy}
              onClick={() => setCurrentDir(parentDir(currentDir))}
            >
              <ArrowUp className="h-3 w-3" /> Up
            </Button>
          </div>
          <div className="scrollbar-thin max-h-64 min-h-24 overflow-y-auto p-1">
            {loading && (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading...
              </div>
            )}
            {!loading && error && (
              <div className="px-2 py-3 text-xs text-destructive">{error}</div>
            )}
            {!loading && !error && entries.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                No subdirectories
              </div>
            )}
            {!loading &&
              !error &&
              entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onClick={() => setCurrentDir(entry.path)}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
          </div>
        </div>
        {isBlocked && (
          <p className="text-destructive text-xs">
            Cannot {mode} &ldquo;{itemLabel}&rdquo; into itself or its own subtree
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onChoose(currentDir)}
            disabled={chooseDisabled}
            title={currentDir}
          >
            Choose this directory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}