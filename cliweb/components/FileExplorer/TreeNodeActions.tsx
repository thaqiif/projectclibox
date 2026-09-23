"use client";

import { useState } from "react";
import { MoreHorizontal, Loader2 } from "lucide-react";
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
  fileDelete,
} from "@/lib/file-ops";
import type { FileNode } from "@/lib/file-utils";

interface FileOpsMenuProps {
  node: FileNode;
  workingDirectory: string;
  onDone?: () => void;
}

/**
 * Per-node "..." action menu: New Folder / New File (only on directories),
 * Rename, Delete. Wraps POST /api/files/ops via lib/file-ops helpers.
 * Intentionally self-contained: the team wires it into ListingBody.
 */
export function FileOpsMenu({ node, workingDirectory, onDone }: FileOpsMenuProps) {
  const [busy, setBusy] = useState(false);

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

  const handleDelete = () => {
    if (!confirm(`Delete "${node.name}"${node.type === "directory" ? " (and all contents)" : ""}? This cannot be undone.`)) {
      return;
    }
    run(() => fileDelete(node.path));
  };

  return (
    <DropdownMenu>
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
      <DropdownMenuContent align="start" className="w-44">
        {node.type === "directory" && (
          <>
            <DropdownMenuItem onClick={handleNewFolder}>New Folder</DropdownMenuItem>
            <DropdownMenuItem onClick={handleNewFile}>New File</DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onClick={handleRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleDelete}
          className={cn("text-destructive focus:text-destructive")}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
