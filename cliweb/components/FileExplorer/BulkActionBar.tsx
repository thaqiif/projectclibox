"use client";

/**
 * Floating bulk-action bar for the multi-select file listing.
 * Rendered by the file listing when the selection is non-empty (position it
 * with an absolutely-positioned ancestor). Owns the Move/Copy
 * DirPickerDialogs and the Delete confirm dialog, runs the ops through
 * lib/file-bulk helpers, reports per-item failures in one message, and calls
 * onRefresh / onClear when done.
 */
import { useState } from "react";
import { FolderInput, FolderOutput, Loader2, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DirPickerDialog } from "./DirPickerDialog";
import {
  bulkCopy,
  bulkDelete,
  bulkMove,
  summarizeBulkResult,
  type BulkOpResult,
} from "@/lib/file-bulk";

export interface BulkActionBarProps {
  selectedPaths: readonly string[];
  /** Directory the listing is showing; Move/Copy start browsing here. */
  workingDirectory: string;
  /** True when every currently listed row is selected; upgrades the count
   * copy to "All N items selected" without changing which paths are acted on
   * (ops always run over the concrete selectedPaths list). */
  allSelected?: boolean;
  /** Called after any successful bulk op so the listing refetches. */
  onRefresh?: () => void;
  /** Called to empty the selection (after Clear and after successful ops). */
  onClear: () => void;
}

type PendingDialog = "move" | "copy" | "delete" | null;

export function BulkActionBar({
  selectedPaths,
  workingDirectory,
  allSelected = false,
  onRefresh,
  onClear,
}: BulkActionBarProps) {
  const [dialog, setDialog] = useState<PendingDialog>(null);
  const [running, setRunning] = useState(false);

  const count = selectedPaths.length;
  // Product rule: the ONLY blocked bulk destination is the current directory
  // itself (moving items into the folder they are already listed from is at
  // best a no-op / conflict). Everything else — the parent, sibling folders,
  // subfolders — must stay pickable. Only an exact match is blocked; per-item
  // cycle checks (a selected directory moved into itself) stay on the server.
  const blockedDirs = [workingDirectory];
  const blockedMessage =
    "The current directory is the only destination that is blocked: pick any other folder.";

  const report = (verb: string, result: BulkOpResult) => {
    if (result.succeeded.length > 0) {
      onRefresh?.();
      onClear();
    }
    const text = summarizeBulkResult(verb, result);
    if (text) window.alert(text);
  };

  const runBulkOp = async (kind: "move" | "copy", toDir: string) => {
    setRunning(true);
    try {
      const result =
        kind === "move"
          ? await bulkMove(selectedPaths, toDir)
          : await bulkCopy(selectedPaths, toDir);
      report(kind === "move" ? "Moved" : "Copied", result);
    } finally {
      setRunning(false);
      setDialog(null);
    }
  };

  const runDelete = async () => {
    setRunning(true);
    try {
      const result = await bulkDelete(selectedPaths);
      report("Trashed", result);
    } finally {
      setRunning(false);
      setDialog(null);
    }
  };

  if (count === 0) return null;
  const noun = count === 1 ? "item" : "items";
  // "All" wording when the header checkbox is fully checked; falls back to
  // the plain count when the selection is partial or stale.
  const countLabel =
    allSelected && count > 1
      ? `All ${count} ${noun} selected`
      : `${count} ${noun} selected`;

  return (
    <>
      <div
        role="toolbar"
        aria-label="Bulk actions for selected files"
        // flex-wrap + max-w so the bar stays usable on narrow screens
        // (mobile) instead of overflowing horizontally.
        className="absolute bottom-3 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] flex-wrap-reverse justify-center -translate-x-1/2 items-center gap-2 rounded-2xl border border-border bg-background/95 px-3 py-1.5 shadow-lg backdrop-blur md:rounded-full md:flex-nowrap md:max-w-full"
      >
        {running ? (
          <span className="ui-meta flex items-center gap-1.5 px-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working...
          </span>
        ) : (
          <>
            <span className="ui-meta whitespace-nowrap">{countLabel}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setDialog("move")}
            >
              <FolderInput className="h-3.5 w-3.5" /> Move to...
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setDialog("copy")}
            >
              <FolderOutput className="h-3.5 w-3.5" /> Copy to...
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setDialog("delete")}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={onClear}
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          </>
        )}
      </div>

      <DirPickerDialog
        open={dialog === "move" || dialog === "copy"}
        mode={dialog === "copy" ? "copy" : "move"}
        itemLabel={`${count} selected ${noun}`}
        startDir={workingDirectory}
        blockedDirs={blockedDirs}
        blockExact
        blockedMessage={blockedMessage}
        busy={running}
        onChoose={(dir) => void runBulkOp(dialog === "copy" ? "copy" : "move", dir)}
        onCancel={() => setDialog(null)}
      />

      <Dialog
        open={dialog === "delete"}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDialog(null);
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete {count} {noun}?
            </DialogTitle>
            <DialogDescription>
              Move {count} selected {noun} to trash? Each item will be removed
              permanently after the undo window.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={running}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void runDelete()} disabled={running}>
              <Trash2 className="h-4 w-4" /> Move to Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
