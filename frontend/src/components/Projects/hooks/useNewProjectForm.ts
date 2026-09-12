import { useState, useEffect, useCallback } from "react";
import { useCreateProject } from "@/data/projects";
import {
  RECENT_DIRS_KEY,
  MAX_RECENT_DIRS,
} from "../NewProjectDialog.types";

export function useNewProjectForm(
  onClose: () => void,
  onCreated: (projectId: string) => void
) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("~");
  const [error, setError] = useState<string | null>(null);
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const createProject = useCreateProject();

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const saved = localStorage.getItem(RECENT_DIRS_KEY);
      if (!saved) return;

      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        const frame = requestAnimationFrame(() => setRecentDirs(parsed));
        return () => cancelAnimationFrame(frame);
      }
    } catch {
      // Invalid or unavailable storage should not block project creation.
    }
  }, []);

  const addRecentDirectory = useCallback((directory: string) => {
    if (!directory || directory === "~") return;

    setRecentDirs((previous) => {
      const filtered = previous.filter((entry) => entry !== directory);
      const updated = [directory, ...filtered].slice(0, MAX_RECENT_DIRS);
      try {
        localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(updated));
      } catch {
        // Private mode, or storage is full. The form still works.
      }
      return updated;
    });
  }, []);

  const handleClose = useCallback(() => {
    setName("");
    setWorkingDirectory("~");
    setError(null);
    onClose();
  }, [onClose]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!workingDirectory || workingDirectory === "~") {
      setError("Working directory is required");
      return;
    }

    if (!name.trim()) {
      setError("Project name is required");
      return;
    }

    createProject.mutate(
      {
        name: name.trim(),
        workingDirectory,
      },
      {
        onSuccess: (data) => {
          addRecentDirectory(workingDirectory);
          handleClose();
          onCreated(data.id);
        },
        onError: (requestError) => {
          setError(requestError.message || "Failed to create project");
        },
      }
    );
  };

  return {
    name,
    setName,
    workingDirectory,
    setWorkingDirectory,
    error,
    recentDirs,
    isPending: createProject.isPending,
    handleSubmit,
    handleClose,
  };
}
