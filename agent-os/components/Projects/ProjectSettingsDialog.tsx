"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  Server,
  GitBranch,
  Star,
  FolderOpen,
  ArrowRight,
} from "lucide-react";
import { FolderPicker } from "@/components/FolderPicker";
import { useUpdateProject } from "@/data/projects";
import { useQueryClient } from "@tanstack/react-query";
import { devServerKeys } from "@/data/dev-servers";
import { repositoryKeys } from "@/data/repositories";
import type {
  ProjectWithRepositories,
  DetectedDevServer,
} from "@/lib/projects";

interface DevServerConfig {
  id: string;
  name: string;
  type: "node" | "docker";
  command: string;
  port?: number;
  portEnvVar?: string;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface RepositoryConfig {
  id: string;
  name: string;
  path: string;
  isPrimary: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface ProjectSettingsDialogProps {
  project: ProjectWithRepositories | null;
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
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [devServers, setDevServers] = useState<DevServerConfig[]>([]);
  const [repositories, setRepositories] = useState<RepositoryConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isDetectingRepos, setIsDetectingRepos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderPickerRepoId, setFolderPickerRepoId] = useState<string | null>(
    null
  );

  const updateProject = useUpdateProject();
  const queryClient = useQueryClient();

  // Initialize form when project changes
  useEffect(() => {
    if (project) {
      setName(project.name);
      setWorkingDirectory(project.working_directory);
      setDevServers(
        project.devServers.map((ds) => ({
          id: ds.id,
          name: ds.name,
          type: ds.type,
          command: ds.command,
          port: ds.port || undefined,
          portEnvVar: ds.port_env_var || undefined,
        }))
      );
      setRepositories(
        (project.repositories || []).map((repo) => ({
          id: repo.id,
          name: repo.name,
          path: repo.path,
          isPrimary: repo.is_primary,
        }))
      );
      // Reset folder picker state when project changes
      setFolderPickerRepoId(null);
    }
  }, [project]);

  // Reset folder picker when dialog closes
  useEffect(() => {
    if (!open) {
      setFolderPickerRepoId(null);
    }
  }, [open]);

  // Detect dev servers
  const detectDevServers = async () => {
    if (!workingDirectory) return;

    setIsDetecting(true);
    try {
      const res = await fetch("/api/projects/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workingDirectory }),
      });

      if (res.ok) {
        const data = await res.json();
        const detected = (data.detected || []) as DetectedDevServer[];

        // Add detected servers that don't already exist
        const existingCommands = new Set(devServers.map((ds) => ds.command));
        const newServers = detected
          .filter((d) => !existingCommands.has(d.command))
          .map((d, i) => ({
            id: `new_${Date.now()}_${i}`,
            name: d.name,
            type: d.type,
            command: d.command,
            port: d.port,
            portEnvVar: d.portEnvVar,
            isNew: true,
          }));

        setDevServers((prev) => [...prev, ...newServers]);
      }
    } catch (err) {
      console.error("Failed to detect dev servers:", err);
    } finally {
      setIsDetecting(false);
    }
  };

  // Add new dev server config
  const addDevServer = () => {
    setDevServers((prev) => [
      ...prev,
      {
        id: `new_${Date.now()}`,
        name: "",
        type: "node",
        command: "",
        isNew: true,
      },
    ]);
  };

  // Remove dev server config
  const removeDevServer = (id: string) => {
    setDevServers(
      (prev) =>
        prev
          .map((ds) =>
            ds.id === id
              ? ds.isNew
                ? null // Remove new items completely
                : { ...ds, isDeleted: true } // Mark existing for deletion
              : ds
          )
          .filter(Boolean) as DevServerConfig[]
    );
  };

  // Update dev server config
  const updateDevServer = (id: string, updates: Partial<DevServerConfig>) => {
    setDevServers((prev) =>
      prev.map((ds) => (ds.id === id ? { ...ds, ...updates } : ds))
    );
  };

  // Detect git repositories in working directory
  const detectRepositories = async () => {
    if (!workingDirectory) return;

    setIsDetectingRepos(true);
    try {
      // Check if the working directory itself is a git repo
      const res = await fetch(
        `/api/git/status?path=${encodeURIComponent(workingDirectory)}`
      );
      if (res.ok) {
        const existingPaths = new Set(repositories.map((r) => r.path));
        if (!existingPaths.has(workingDirectory)) {
          // Extract repo name from path
          const pathParts = workingDirectory.split("/").filter(Boolean);
          const repoName = pathParts[pathParts.length - 1] || "Repository";

          setRepositories((prev) => [
            ...prev,
            {
              id: `new_${Date.now()}`,
              name: repoName,
              path: workingDirectory,
              isPrimary: prev.length === 0,
              isNew: true,
            },
          ]);
        }
      }
    } catch {
      // Not a git repo, that's okay
    } finally {
      setIsDetectingRepos(false);
    }
  };

  // Add new repository config - opens folder picker directly
  const addRepository = () => {
    const newId = `new_${Date.now()}`;
    setRepositories((prev) => [
      ...prev,
      {
        id: newId,
        name: "",
        path: "",
        isPrimary: prev.filter((r) => !r.isDeleted).length === 0,
        isNew: true,
      },
    ]);
    // Open folder picker for the new repository
    setFolderPickerRepoId(newId);
  };

  // Remove repository config
  const removeRepository = (id: string) => {
    setRepositories(
      (prev) =>
        prev
          .map((repo) =>
            repo.id === id
              ? repo.isNew
                ? null // Remove new items completely
                : { ...repo, isDeleted: true } // Mark existing for deletion
              : repo
          )
          .filter(Boolean) as RepositoryConfig[]
    );
  };

  // Update repository config
  const updateRepository = (id: string, updates: Partial<RepositoryConfig>) => {
    setRepositories((prev) =>
      prev.map((repo) => (repo.id === id ? { ...repo, ...updates } : repo))
    );
  };

  // Set a repository as primary
  const setRepositoryPrimary = (id: string) => {
    setRepositories((prev) =>
      prev.map((repo) => ({
        ...repo,
        isPrimary: repo.id === id,
      }))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    setError(null);

    if (!name.trim()) {
      setError("Project name is required");
      return;
    }

    setIsLoading(true);
    try {
      // Update project settings using mutation (properly invalidates cache)
      await updateProject.mutateAsync({
        projectId: project.id,
        name: name.trim(),
        workingDirectory,
      });

      // Handle dev server changes
      for (const ds of devServers) {
        if (ds.isDeleted && !ds.isNew) {
          // Delete existing dev server
          await fetch(`/api/projects/${project.id}/dev-servers/${ds.id}`, {
            method: "DELETE",
          });
        } else if (
          ds.isNew &&
          !ds.isDeleted &&
          ds.name.trim() &&
          ds.command.trim()
        ) {
          // Create new dev server
          await fetch(`/api/projects/${project.id}/dev-servers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: ds.name.trim(),
              type: ds.type,
              command: ds.command.trim(),
              port: ds.port || undefined,
              portEnvVar: ds.portEnvVar || undefined,
            }),
          });
        } else if (!ds.isNew && !ds.isDeleted) {
          // Update existing dev server
          await fetch(`/api/projects/${project.id}/dev-servers/${ds.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: ds.name.trim(),
              type: ds.type,
              command: ds.command.trim(),
              port: ds.port || undefined,
              portEnvVar: ds.portEnvVar || undefined,
            }),
          });
        }
      }

      // Handle repository changes
      for (const repo of repositories) {
        if (repo.isDeleted && !repo.isNew) {
          // Delete existing repository
          await fetch(`/api/projects/${project.id}/repositories/${repo.id}`, {
            method: "DELETE",
          });
        } else if (
          repo.isNew &&
          !repo.isDeleted &&
          repo.name.trim() &&
          repo.path.trim()
        ) {
          // Create new repository
          await fetch(`/api/projects/${project.id}/repositories`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: repo.name.trim(),
              path: repo.path.trim(),
              isPrimary: repo.isPrimary,
            }),
          });
        } else if (!repo.isNew && !repo.isDeleted) {
          // Update existing repository
          await fetch(`/api/projects/${project.id}/repositories/${repo.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: repo.name.trim(),
              path: repo.path.trim(),
              isPrimary: repo.isPrimary,
            }),
          });
        }
      }

      // Invalidate dev servers cache so list updates
      queryClient.invalidateQueries({ queryKey: devServerKeys.list() });
      // Invalidate repositories cache
      queryClient.invalidateQueries({
        queryKey: repositoryKeys.list(project.id),
      });

      handleClose();
      onSave();
    } catch (err) {
      console.error("Failed to update project:", err);
      setError("Failed to update project");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setFolderPickerRepoId(null);
    onClose();
  };

  const visibleDevServers = devServers.filter((ds) => !ds.isDeleted);
  const visibleRepositories = repositories.filter((repo) => !repo.isDeleted);

  if (!project) return null;

  return (
    <>
      <Dialog
        open={open && !folderPickerRepoId}
        onOpenChange={(o) => !o && handleClose()}
      >
        <DialogContent className="scrollbar-thin max-h-[90vh] max-w-lg gap-0 overflow-y-auto p-0">
          <DialogHeader className="border-b border-[var(--fill-2)] px-6 py-4">
            <DialogTitle className="type-title-3">Project settings</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit}>
            <div className="divide-y divide-[var(--fill-3)] px-6">
              {/* Project Name */}
              <div className="space-y-2 py-4">
                <div className="flex items-center gap-2"><label htmlFor="project-settings-name" className="text-[0.8125rem] font-medium text-foreground">
                    Project Name
                  </label>
                </div>
                <Input
                  id="project-settings-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-awesome-project"
                  className="font-mono text-sm"
                />
              </div>

              {/* Working Directory */}
              <div className="space-y-2 py-4">
                <div className="flex items-center gap-2"><label
                    htmlFor="project-settings-working-directory"
                    className="text-[0.8125rem] font-medium text-foreground"
                  >
                    Working Directory
                  </label>
                </div>
                <Input
                  id="project-settings-working-directory"
                  value={workingDirectory}
                  onChange={(e) => setWorkingDirectory(e.target.value)}
                  placeholder="~/projects/my-app"
                  className="font-mono text-sm"
                />
              </div>

            {/* Dev Servers */}
            <div className="space-y-3 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><label className="ui-label flex items-center gap-2">
                    <Server className="h-3.5 w-3.5" />
                    Dev Servers
                  </label>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={detectDevServers}
                    disabled={isDetecting || !workingDirectory}
                    className=""
                  >
                    {isDetecting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Detect
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addDevServer}
                    className=""
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </Button>
                </div>
              </div>

              {visibleDevServers.length === 0 ? (
                <p className="ui-meta py-2">
                  No dev servers configured.
                </p>
              ) : (
                <div className="divide-y divide-[var(--fill-3)] border-y border-[var(--fill-2)]">
                  {visibleDevServers.map((ds) => (
                    <div key={ds.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <Input
                          value={ds.name}
                          onChange={(e) =>
                            updateDevServer(ds.id, { name: e.target.value })
                          }
                          placeholder="Server name"
                          className="h-8 flex-1 font-mono text-sm"
                        />
                        <Select
                          value={ds.type}
                          onValueChange={(v) =>
                            updateDevServer(ds.id, {
                              type: v as "node" | "docker",
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="node">Node</SelectItem>
                            <SelectItem value="docker">Docker</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeDevServer(ds.id)}
                          aria-label={`Remove dev server ${ds.name || ds.id}`}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-status-error"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <Input
                        value={ds.command}
                        onChange={(e) =>
                          updateDevServer(ds.id, { command: e.target.value })
                        }
                        placeholder={
                          ds.type === "docker" ? "Service name" : "npm run dev"
                        }
                        className="h-8 font-mono text-sm"
                      />
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          value={ds.port || ""}
                          onChange={(e) =>
                            updateDevServer(ds.id, {
                              port: e.target.value
                                ? parseInt(e.target.value)
                                : undefined,
                            })
                          }
                          placeholder="Port"
                          className="h-8 w-24 font-mono text-sm"
                        />
                        <Input
                          value={ds.portEnvVar || ""}
                          onChange={(e) =>
                            updateDevServer(ds.id, {
                              portEnvVar: e.target.value,
                            })
                          }
                          placeholder="Port env var (e.g., PORT)"
                          className="h-8 flex-1 font-mono text-sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Repositories */}
            <div className="space-y-3 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><label className="ui-label flex items-center gap-2">
                    <GitBranch className="h-3.5 w-3.5" />
                    Git Repositories
                  </label>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={detectRepositories}
                    disabled={isDetectingRepos || !workingDirectory}
                    className=""
                  >
                    {isDetectingRepos ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Detect
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addRepository}
                    className=""
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </Button>
                </div>
              </div>

              {visibleRepositories.length === 0 ? (
                <p className="ui-meta py-2">
                  No repositories configured. Git changes will use the working
                  directory.
                </p>
              ) : (
                <div className="divide-y divide-[var(--fill-3)] border-y border-[var(--fill-2)]">
                  {visibleRepositories.map((repo) => (
                    <div key={repo.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <Input
                          value={repo.name}
                          onChange={(e) =>
                            updateRepository(repo.id, { name: e.target.value })
                          }
                          placeholder="Repository name"
                          className="h-8 flex-1 font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant={repo.isPrimary ? "default" : "ghost"}
                          size="icon-sm"
                          onClick={() => setRepositoryPrimary(repo.id)}
                          title={
                            repo.isPrimary
                              ? "Primary repository"
                              : "Set as primary"
                          }
                          aria-label={
                            repo.isPrimary
                              ? `Primary repository ${repo.name || repo.id}`
                              : `Set ${repo.name || repo.id} as primary`
                          }
                        >
                          <Star
                            className={`h-3 w-3 ${repo.isPrimary ? "fill-current" : ""}`}
                          />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeRepository(repo.id)}
                          aria-label={`Remove repository ${repo.name || repo.id}`}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-status-error"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={repo.path}
                          onChange={(e) =>
                            updateRepository(repo.id, { path: e.target.value })
                          }
                          placeholder="~/path/to/repository"
                          className="h-8 flex-1 font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          onClick={() => setFolderPickerRepoId(repo.id)}
                          title="Browse folders"
                          aria-label="Browse folders"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                Configure multiple git repositories to track changes across
                repos.
              </p>
            </div>

            {error && (
              <p className="flex items-center gap-2 pt-3 pb-4 font-mono text-xs text-status-error">
                <span className="h-1.5 w-1.5 shrink-0 animate-status-pulse bg-status-error" />
                {error}
              </p>
            )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--fill-2)] px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className=""
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading}
              className=""
            >
              {isLoading ? "Saving..." : "Save Changes"}
              {!isLoading && (
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Folder Picker for repository path */}
      {folderPickerRepoId && (
        <FolderPicker
          key={folderPickerRepoId}
          initialPath={
            repositories.find((r) => r.id === folderPickerRepoId)?.path ||
            workingDirectory ||
            "~"
          }
          onSelect={(path) => {
            // Capture repoId immediately - must be done before any state updates
            const repoId = folderPickerRepoId;
            if (!repoId) return;

            // Auto-fill name from path if empty
            const pathParts = path.split("/").filter(Boolean);
            const name = pathParts[pathParts.length - 1] || "Repository";

            // First close the picker
            setFolderPickerRepoId(null);

            // Then update the repository
            setRepositories((prev) =>
              prev.map((r) =>
                r.id === repoId ? { ...r, path, name: r.name || name } : r
              )
            );
          }}
          onClose={() => {
            // Capture repoId immediately
            const repoId = folderPickerRepoId;

            // First close the picker
            setFolderPickerRepoId(null);

            // If the repo has no path (user cancelled on new repo), remove it
            if (repoId) {
              setRepositories((prev) => {
                const repo = prev.find((r) => r.id === repoId);
                if (repo?.isNew && !repo.path) {
                  return prev.filter((r) => r.id !== repoId);
                }
                return prev;
              });
            }
          }}
        />
      )}
    </>
  );
}
