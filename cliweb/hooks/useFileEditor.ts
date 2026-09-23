import { useState, useCallback } from "react";
import { getLanguageFromExtension } from "@/lib/file-utils";

export interface OpenFile {
  path: string;
  content: string;
  currentContent: string;
  isBinary: boolean;
  /**
   * The server could not return the full file (size over the read limit).
   * The content here is a placeholder note, never the document; saving it
   * would destroy the real file, so saves are refused.
   */
  truncated: boolean;
  language: string;
  /**
   * Server mtime captured when the content was last read from (or written
   * to) disk. Sent as expectedMtimeMs on save so the server can reject a
   * write when the file changed underneath us. Null for never-fetched
   * files (new files), which skips conflict detection.
   */
  mtimeMs: number | null;
}

export interface UseFileEditorReturn {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  loading: boolean;
  saving: boolean;
  /** Last save failure message, or null when the last save succeeded. */
  saveError: string | null;
  /**
   * Path of a save that was rejected with a conflict (file changed on disk
   * since open), or null. While set, the local edits are intact and the
   * file stays dirty; the UI should show the SaveConflictDialog.
   */
  conflictFilePath: string | null;
  /** Server mtime reported by the 409 response for conflictFilePath. */
  conflictServerMtimeMs: number | null;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  saveFile: (
    path: string,
    options?: { force?: boolean }
  ) => Promise<{
    ok: boolean;
    error?: string;
    /** True when the save was rejected because the file changed on disk. */
    conflict?: boolean;
    /** Server mtime at conflict time, when conflict is true. */
    serverMtimeMs?: number;
  }>;
  saveAllFiles: () => Promise<void>;
  /** Discard local edits for a conflicted file and reload the server version. */
  reloadConflictedFile: (path: string) => Promise<void>;
  /** Clear the conflict flag without changing file state (dialog Cancel). */
  dismissConflict: () => void;
  isDirty: (path: string) => boolean;
  hasUnsavedChanges: boolean;
  getFile: (path: string) => OpenFile | undefined;
  reset: () => void;
}

export function useFileEditor(): UseFileEditorReturn {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictFilePath, setConflictFilePath] = useState<string | null>(null);
  const [conflictServerMtimeMs, setConflictServerMtimeMs] = useState<
    number | null
  >(null);

  const getFile = useCallback(
    (path: string) => openFiles.find((f) => f.path === path),
    [openFiles]
  );

  const isDirty = useCallback(
    (path: string) => {
      const file = openFiles.find((f) => f.path === path);
      return file ? file.content !== file.currentContent : false;
    },
    [openFiles]
  );

  const hasUnsavedChanges = openFiles.some(
    (f) => f.content !== f.currentContent
  );

  const openFile = useCallback(
    async (path: string) => {
      // Check if file is already open
      const existing = openFiles.find((f) => f.path === path);
      if (existing) {
        setActiveFilePath(path);
        // Keep server_fetch freshness: refetch the current content unless the
        // user has unsaved edits that a refetch would overwrite.
        if (existing.content !== existing.currentContent) return;

        setLoading(true);
        try {
          const res = await fetch(
            `/api/files/content?path=${encodeURIComponent(path)}`
          );
          const data = await res.json();

          if (data.error) {
            console.error("Failed to refresh file:", data.error);
            return;
          }

          setOpenFiles((prev) =>
            prev.map((f) =>
              f.path === data.path
                ? {
                    ...f,
                    content: data.content,
                    isBinary: data.isBinary,
                    truncated: data.truncated === true,
                    mtimeMs: typeof data.mtimeMs === "number" ? data.mtimeMs : null,
                  }
                : f
            )
          );
        } catch (error) {
          console.error("Failed to refresh file:", error);
        } finally {
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(
          `/api/files/content?path=${encodeURIComponent(path)}`
        );
        const data = await res.json();

        if (data.error) {
          console.error("Failed to open file:", data.error);
          return;
        }

        const ext = path.split(".").pop() || "";
        const newFile: OpenFile = {
          path: data.path,
          content: data.content,
          currentContent: data.content,
          isBinary: data.isBinary,
          truncated: data.truncated === true,
          mtimeMs: typeof data.mtimeMs === "number" ? data.mtimeMs : null,
          language: getLanguageFromExtension(ext),
        };

        setOpenFiles((prev) => [...prev, newFile]);
        setActiveFilePath(data.path);
      } catch (error) {
        console.error("Failed to open file:", error);
      } finally {
        setLoading(false);
      }
    },
    [openFiles]
  );

  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const newFiles = prev.filter((f) => f.path !== path);
      // Update active file if we closed the active one
      setActiveFilePath((currentActive) => {
        if (currentActive !== path) return currentActive;
        // Select the next file, or previous, or null
        const closedIndex = prev.findIndex((f) => f.path === path);
        if (newFiles.length === 0) return null;
        if (closedIndex >= newFiles.length)
          return newFiles[newFiles.length - 1].path;
        return newFiles[closedIndex].path;
      });
      return newFiles;
    });
  }, []);

  const updateContent = useCallback((path: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, currentContent: content } : f))
    );
  }, []);

  const saveFile = useCallback(
    async (
      path: string,
      options?: { force?: boolean }
    ): Promise<{
      ok: boolean;
      error?: string;
      conflict?: boolean;
      serverMtimeMs?: number;
    }> => {
      const file = openFiles.find((f) => f.path === path);
      if (!file) {
        const message = "File not found";
        setSaveError(message);
        return { ok: false, error: message };
      }
      if (file.isBinary || file.truncated) {
        const message =
          "This file is binary or too large to edit and cannot be saved. Use download instead.";
        setSaveError(message);
        return { ok: false, error: message };
      }

      setSaving(true);
      try {
        const res = await fetch("/api/files/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path,
            content: file.currentContent,
            // Omit for new files we have never fetched (server force
            // writes); the server ignores it when force is true anyway.
            ...(file.mtimeMs !== null ? { expectedMtimeMs: file.mtimeMs } : {}),
            ...(options?.force ? { force: true } : {}),
          }),
        });
        const data = await res.json();

        // 409 from the server means the file changed on disk since we
        // read it. Leave the local content and dirty state untouched and
        // flag the conflict for the dialog.
        if (res.status === 409 && data.error === "conflict") {
          const message = "File changed on disk since it was opened";
          setSaveError(message);
          setConflictFilePath(path);
          setConflictServerMtimeMs(
            typeof data.serverMtimeMs === "number" ? data.serverMtimeMs : null
          );
          return {
            ok: false,
            conflict: true,
            error: message,
            ...(typeof data.serverMtimeMs === "number"
              ? { serverMtimeMs: data.serverMtimeMs }
              : {}),
          };
        }

        if (data.error) {
          const message: string = data.error;
          setSaveError(message);
          return { ok: false, error: message };
        }

        // Update the saved content to match current and record the
        // post-write mtime so our next save does not conflict with our
        // own write.
        setSaveError(null);
        setConflictFilePath(null);
        setConflictServerMtimeMs(null);
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === path
              ? {
                  ...f,
                  content: f.currentContent,
                  mtimeMs:
                    typeof data.mtimeMs === "number" ? data.mtimeMs : f.mtimeMs,
                }
              : f
          )
        );

        return { ok: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save";
        setSaveError(message);
        return { ok: false, error: message };
      } finally {
        setSaving(false);
      }
    },
    [openFiles]
  );

  const saveAllFiles = useCallback(async () => {
    const dirtyFiles = openFiles.filter((f) => f.content !== f.currentContent);
    for (const file of dirtyFiles) {
      await saveFile(file.path);
    }
  }, [openFiles, saveFile]);

  /**
   * Discard local edits and reload the server version for a conflicted
   * file. Implemented directly (not via openFile) so it works even though
   * the file is still in openFiles with unsaved edits; the tab stays open,
   * content/currentContent are reset to the server version, and the fresh
   * mtime is captured for future saves.
   */
  const reloadConflictedFile = useCallback(
    async (path: string) => {
      setConflictFilePath(null);
      setConflictServerMtimeMs(null);
      setLoading(true);
      try {
        const res = await fetch(
          `/api/files/content?path=${encodeURIComponent(path)}`
        );
        const data = await res.json();

        if (data.error) {
          console.error("Failed to reload file:", data.error);
          setSaveError(data.error);
          return;
        }

        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === path
              ? {
                  ...f,
                  content: data.content,
                  currentContent: data.content,
                  isBinary: data.isBinary,
                  truncated: data.truncated === true,
                  mtimeMs:
                    typeof data.mtimeMs === "number" ? data.mtimeMs : null,
                }
              : f
          )
        );
      } catch (error) {
        console.error("Failed to reload file:", error);
        setSaveError(
          error instanceof Error ? error.message : "Failed to reload file"
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /** Clear the conflict flag without changing any file state. */
  const dismissConflict = useCallback(() => {
    setConflictFilePath(null);
    setConflictServerMtimeMs(null);
  }, []);

  const reset = useCallback(() => {
    setOpenFiles([]);
    setActiveFilePath(null);
    setSaveError(null);
    setConflictFilePath(null);
    setConflictServerMtimeMs(null);
  }, []);

  return {
    openFiles,
    activeFilePath,
    loading,
    saving,
    saveError,
    conflictFilePath,
    conflictServerMtimeMs,
    openFile,
    closeFile,
    setActiveFile: setActiveFilePath,
    updateContent,
    saveFile,
    reloadConflictedFile,
    dismissConflict,
    saveAllFiles,
    isDirty,
    hasUnsavedChanges,
    getFile,
    reset,
  };
}
