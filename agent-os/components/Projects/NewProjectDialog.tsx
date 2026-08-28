"use client";

import { ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NewProjectDialogProps } from "./NewProjectDialog.types";
import { useNewProjectForm } from "./hooks/useNewProjectForm";
import { DirectoryField } from "./DirectoryField";

export function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: NewProjectDialogProps) {
  const form = useNewProjectForm(onClose, onCreated);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && form.handleClose()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b border-[var(--fill-2)] px-6 py-4">
          <DialogTitle className="type-title-3">New project</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit}>
          <div className="divide-y divide-[var(--fill-3)] px-6">
            <div className="space-y-2 py-4">
              <label
                htmlFor="new-project-name"
                className="text-[0.8125rem] font-medium text-foreground"
              >
                Project Name
              </label>
              <Input
                id="new-project-name"
                value={form.name}
                onChange={(event) => form.setName(event.target.value)}
                placeholder="my-awesome-project"
                className="font-mono text-sm"
                autoFocus
              />
            </div>

            <div className="py-4">
              <DirectoryField
                label="Working Directory"
                value={form.workingDirectory}
                onChange={form.setWorkingDirectory}
                recentDirs={form.recentDirs}
              />
            </div>

            {form.error && (
              <p className="flex items-center gap-2 pt-3 pb-4 font-mono text-xs text-status-error">
                <span className="h-1.5 w-1.5 shrink-0 animate-status-pulse bg-status-error" />
                {form.error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--fill-2)] px-6 py-4">
            <Button type="button" variant="outline" onClick={form.handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.isPending}>
              {form.isPending ? "Creating..." : "Create Project"}
              {!form.isPending && (
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
