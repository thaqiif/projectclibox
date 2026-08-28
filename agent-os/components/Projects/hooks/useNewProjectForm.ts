import { useState, useEffect, useCallback } from "react";
import { useCreateProject } from "@/data/projects";
import { useGitCheck, useCloneRepo } from "@/data/git/queries";
import {
  RECENT_DIRS_KEY,
  MAX_RECENT_DIRS,
  CLONE_STEP,
  extractRepoName,
  type CloneStep,
} from "../NewProjectDialog.types";

export function useNewProjectForm(
  mode: "new" | "clone",
  onClose: () => void,
  onCreated: (projectId: string) => void
) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("~");
  const [debouncedDir, setDebouncedDir] = useState("~");
  const [error, setError] = useState<string | null>(null);
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [githubUrl, setGithubUrl] = useState("");
  const [cloneStep, setCloneStep] = useState<CloneStep>(CLONE_STEP.IDLE);

  const isCloneMode = mode === "clone";

  // React Query hooks
  const createProject = useCreateProject();
  const cloneRepo = useCloneRepo();

  const gitCheck = useGitCheck(debouncedDir);

  // Debounce directory for git check query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedDir(workingDirectory), 500);
    return () => clearTimeout(timer);
  }, [workingDirectory]);

  // Load recent directories
  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame: number | null = null;
    try {
      const saved = localStorage.getItem(RECENT_DIRS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          frame = requestAnimationFrame(() => setRecentDirs(parsed));
        }
      }
    } catch {
      // Ignore
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  // Save recent directory
  const addRecentDirectory = useCallback((dir: string) => {
    if (!dir || dir === "~") return;
    setRecentDirs((prev) => {
      const filtered = prev.filter((d) => d !== dir);
      const updated = [dir, ...filtered].slice(0, MAX_RECENT_DIRS);
      localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleClose = () => {
    setName("");
    setWorkingDirectory("~");
    setGithubUrl("");
    setCloneStep(CLONE_STEP.IDLE);
    setError(null);
    onClose();
  };

  const handleGithubUrlChange = (value: string) => {
    setGithubUrl(value);
    const repoName = extractRepoName(value);
    if (repoName && !name) {
      setName(repoName);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!workingDirectory || (!isCloneMode && workingDirectory === "~")) {
      setError("Working directory is required");
      return;
    }

    if (isCloneMode) {
      if (!githubUrl.trim()) {
        setError("GitHub repository URL is required");
        return;
      }

      const projectName =
        name.trim() || extractRepoName(githubUrl.trim()) || "project";

      setCloneStep(CLONE_STEP.CLONING);
      cloneRepo.mutate(
        { url: githubUrl.trim(), directory: workingDirectory },
        {
          onSuccess: (cloneData) => {
            setCloneStep(CLONE_STEP.CREATING);
            createProject.mutate(
              {
                name: projectName,
                workingDirectory: cloneData.path,
              },
              {
                onSuccess: (data) => {
                  setCloneStep(CLONE_STEP.DONE);
                  addRecentDirectory(cloneData.path);
                  setTimeout(() => {
                    handleClose();
                    onCreated(data.project.id);
                  }, 300);
                },
                onError: (err) => {
                  setCloneStep(CLONE_STEP.IDLE);
                  setError(err.message || "Failed to create project");
                },
              }
            );
          },
          onError: (err) => {
            setCloneStep(CLONE_STEP.IDLE);
            setError(err.message || "Failed to clone repository");
          },
        }
      );
      return;
    }

    // Normal mode
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
          onCreated(data.project.id);
        },
        onError: (err) => {
          setError(err.message || "Failed to create project");
        },
      }
    );
  };

  return {
    // State
    name,
    setName,
    workingDirectory,
    setWorkingDirectory,
    error,
    recentDirs,
    isGitRepo: gitCheck.data?.isGitRepo ?? false,
    checkingDir: gitCheck.isFetching,
    githubUrl,
    isCloning: cloneStep !== CLONE_STEP.IDLE,
    cloneStep,
    isCloneMode,
    isPending: createProject.isPending,

    // Actions
    handleGithubUrlChange,
    handleSubmit,
    handleClose,
  };
}
