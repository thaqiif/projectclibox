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
import { Link, GitBranch, FolderPlus, Check } from "lucide-react";
import { CLONE_STEP } from "./NewProjectDialog.types";
import type { NewProjectDialogProps } from "./NewProjectDialog.types";
import { useNewProjectForm } from "./hooks/useNewProjectForm";
import { DirectoryField } from "./DirectoryField";
import { CreatingOverlay, type StepConfig } from "./CreatingOverlay";

const cloneSteps: StepConfig[] = [
  { id: CLONE_STEP.CLONING, label: "Cloning repository", icon: GitBranch },
  { id: CLONE_STEP.CREATING, label: "Creating project", icon: FolderPlus },
  { id: CLONE_STEP.DONE, label: "Done", icon: Check },
];

export function NewProjectDialog({
  open,
  mode = "new",
  onClose,
  onCreated,
}: NewProjectDialogProps) {
  const form = useNewProjectForm(mode, onClose, onCreated);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && form.handleClose()}>
      <DialogContent className="scrollbar-thin max-h-[90vh] max-w-lg gap-0 overflow-y-auto p-0">
        {form.isCloning && (
          <CreatingOverlay
            step={form.cloneStep}
            steps={cloneSteps}
            hint="This may take a moment depending on the repository size"
          />
        )}
        <DialogHeader className="border-b border-[var(--fill-2)] px-6 py-4">
          <DialogTitle className="type-title-3">
            {form.isCloneMode ? "Clone from GitHub" : "New project"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit}>
          <div className="divide-y divide-[var(--fill-3)] px-6">
            {form.isCloneMode && (
              <div className="space-y-2 py-4">
                <div className="flex items-baseline gap-2"><label htmlFor="new-project-github-url" className="text-[0.8125rem] font-medium text-foreground">
                    Repository URL
                  </label>
                </div>
                <div className="relative">
                  <Input
                    id="new-project-github-url"
                    value={form.githubUrl}
                    onChange={(e) => form.handleGithubUrlChange(e.target.value)}
                    placeholder="https://github.com/user/repo"
                    className="font-mono text-sm"
                    autoFocus
                  />
                  <Link className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2" />
                </div>
              </div>
            )}

            <div className="space-y-2 py-4">
              <div className="flex items-baseline gap-2">
                <span className="ui-label">
                  {form.isCloneMode ? "02" : "01"}
                </span>
                <label htmlFor="new-project-name" className="text-[0.8125rem] font-medium text-foreground">
                  Project Name
                </label>
                {form.isCloneMode && (
                  <span className="ui-label">(optional, derived from URL)</span>
                )}
              </div>
              <Input
                id="new-project-name"
                value={form.name}
                onChange={(e) => form.setName(e.target.value)}
                placeholder={
                  form.isCloneMode
                    ? "auto-detected from URL"
                    : "my-awesome-project"
                }
                className="font-mono text-sm"
                autoFocus={!form.isCloneMode}
              />
            </div>

            <div className="py-4">
              <DirectoryField
                label={form.isCloneMode ? "Clone Into" : "Working Directory"}
                value={form.workingDirectory}
                onChange={form.setWorkingDirectory}
                checkingDir={form.checkingDir}
                isGitRepo={form.isGitRepo}
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
            <Button
              type="button"
              variant="outline"
              onClick={form.handleClose}
              className=""
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={form.isPending || form.isCloning}
              className=""
            >
              {form.isCloning
                ? "Cloning..."
                : form.isPending
                  ? "Creating..."
                  : form.isCloneMode
                    ? "Clone & Create"
                    : "Create Project"}
              {!form.isCloning && !form.isPending && (
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
