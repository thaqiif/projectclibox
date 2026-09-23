"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface SaveConflictDialogProps {
  /** True when a save was rejected because the file changed on disk. */
  open: boolean;
  /** Full path (or name) of the conflicted file, shown in the description. */
  fileName: string;
  /** Keep local edits and overwrite the server version (force save). */
  onOverwrite: () => void;
  /** Discard local edits and reload the server version. */
  onReload: () => void;
  /** Keep the file open and dirty, do nothing for now. */
  onCancel: () => void;
}

/**
 * Shown when a save is rejected with a conflict: the file changed on disk
 * after it was opened. The user can overwrite the server version, reload
 * the server version (discarding local edits), or cancel.
 */
export function SaveConflictDialog({
  open,
  fileName,
  onOverwrite,
  onReload,
  onCancel,
}: SaveConflictDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen: boolean) => !isOpen && onCancel()}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <span className="ui-label">Save conflict</span>
          <DialogTitle className="type-title-3">
            File changed on disk
          </DialogTitle>
          <DialogDescription>
            {fileName} was modified outside the editor after it was opened.
            Overwriting will replace the server version with your edits.
            Reloading will discard your unsaved changes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onReload}>
            Reload server version
          </Button>
          <Button onClick={onOverwrite}>Overwrite server version</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
