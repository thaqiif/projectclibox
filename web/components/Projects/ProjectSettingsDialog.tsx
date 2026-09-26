"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight } from "lucide-react";
import { useUpdateProject } from "@/data/projects";
import type { Project } from "@/lib/db";

interface ProjectSettingsDialogProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function ProjectSettingsDialog({
  project,
  open,
  onClose,
  onSave,
}: ProjectSettingsDialogProps) {
  const [name, setName] = useState(project?.name ?? "");
  const [workingDirectory, setWorkingDirectory] = useState(
    project?.working_directory ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const updateProject = useUpdateProject();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Project name is required");
      return;
    }

    setError(null);
    try {
      await updateProject.mutateAsync({
        projectId: project.id,
        name: trimmedName,
        workingDirectory,
      });
      onClose();
      onSave();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to update project"
      );
    }
  };

  if (!project) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b border-[var(--fill-2)] px-6 py-4">
          <DialogTitle className="type-title-3">Project settings</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="divide-y divide-[var(--fill-3)] px-6">
            <div className="space-y-2 py-4">
              <label
                htmlFor="project-settings-name"
                className="text-[0.8125rem] font-medium text-foreground"
              >
                Project Name
              </label>
              <Input
                id="project-settings-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="my-awesome-project"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2 py-4">
              <label
                htmlFor="project-settings-working-directory"
                className="text-[0.8125rem] font-medium text-foreground"
              >
                Working Directory
              </label>
              <Input
                id="project-settings-working-directory"
                value={workingDirectory}
                onChange={(event) => setWorkingDirectory(event.target.value)}
                placeholder="~/projects/my-app"
                className="font-mono text-sm"
              />
            </div>

            {error && (
              <p className="flex items-center gap-2 pt-3 pb-4 font-mono text-xs text-status-error">
                <span className="h-1.5 w-1.5 shrink-0 animate-status-pulse bg-status-error" />
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--fill-2)] px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateProject.isPending}>
              {updateProject.isPending ? "Saving..." : "Save Changes"}
              {!updateProject.isPending && (
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
