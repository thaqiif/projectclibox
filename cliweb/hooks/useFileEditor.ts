import { useState, useCallback, useRef } from "react";
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
    options?: { force?: boolean; allowBinaryOverwrite?: boolean }
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
  /** In-flight save promises keyed by path, so rapid re-saves coalesce. */
  const inFlightSaves = useRef(
    new Map<
      string,
      Promise<{
        ok: boolean;
        error?: string;
        conflict?: boolean;
        serverMtimeMs?: number;
      }>
    >()
  );

  /** Latest openFiles for use inside async callbacks without stale closures. */
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;

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

          // Keep the tab's baseline in sync with what we now show. Both
          // fields move together so a clean file stays clean (a refetch
          // that only updated `content` would fake a dirty flag), and a
          // file that became dirty while the request was in flight is
          // left untouched so the user's typing is never clobbered.
          setOpenFiles((prev) =>
            prev.map((f) =>
              (f.path === data.path || f.path === path) &&
              f.content === f.currentContent
                ? {
                    ...f,
                    path: data.path,
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
      options?: { force?: boolean; allowBinaryOverwrite?: boolean }
    ): Promise<{
      ok: boolean;
      error?: string;
      conflict?: boolean;
      serverMtimeMs?: number;
    }> => {
      // Rapid re-saves (double Mod-S, save button plus keymap) must never
      // interleave two writers for the same file: the second request would
      // race the first and, with mtime gating, 409 against our own write.
      // Coalesce instead: a call while a save is in flight receives the
      // promise already running.
      const pending = inFlightSaves.current.get(path);
      if (pending) return pending;

      const file = openFilesRef.current.find((f) => f.path === path);
      if (!file) {
        const message = "File not found";
        setSaveError(message);
        return { ok: false, error: message };
      }
      if (file.isBinary || file.truncated) {
        // A stale BINARY open is never saved, even by the conflict
        // overwrite path: the editor has no real bytes, only a placeholder.
        const message =
          "This file is binary or too large to edit and cannot be saved. Use download instead.";
        setSaveError(message);
        return { ok: false, error: message };
      }

      const runSave = async (): Promise<{
        ok: boolean;
        error?: string;
        conflict?: boolean;
        serverMtimeMs?: number;
      }> => {
        setSaving(true);
        try {
          // Read again at send time: the state this callback closed over
          // may be one render behind (save while another tab is active,
          // or content typed between callback creation and invoke).
          const fresh = openFilesRef.current.find((f) => f.path === path);
          if (!fresh) {
            const message = "File not found";
            setSaveError(message);
            return { ok: false, error: message };
          }
          const contentAtSend = fresh.currentContent;
          const res = await fetch("/api/files/content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path,
              content: contentAtSend,
              // Omit for new files we have never fetched (server force
              // writes); the server ignores it when force is true anyway.
              ...(fresh.mtimeMs !== null
                ? { expectedMtimeMs: fresh.mtimeMs }
                : {}),
              ...(options?.force ? { force: true } : {}),
              // Only the explicit conflict-overwrite path may replace a
              // text open whose on-disk bytes became binary.
              ...(options?.allowBinaryOverwrite === true
                ? { allowBinaryOverwrite: true }
                : {}),
            }),
          });
          const data = await res.json();

          // 409 from the server means the file changed on disk (or was
          // deleted) since we read it. Leave the local content and dirty
          // state untouched and flag the conflict for the dialog.
          if (res.status === 409 && data.error === "conflict") {
            const message = data.deleted
              ? "File was deleted on disk since it was opened"
              : "File changed on disk since it was opened";
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

          setSaveError(null);
          setConflictFilePath(null);
          setConflictServerMtimeMs(null);
          setOpenFiles((prev) =>
            prev.map((f) =>
              f.path === path
                ? {
                    ...f,
                    // Only clear the dirty flag when the user has not
                    // typed past the bytes we just committed: grabbing
                    // currentContent blindly would mark newer edits saved.
                    ...(f.currentContent === contentAtSend
                      ? { content: f.currentContent }
                      : {}),
                    mtimeMs:
                      typeof data.mtimeMs === "number"
                        ? data.mtimeMs
                        : f.mtimeMs,
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
      };

      const promise = runSave().finally(() => {
        inFlightSaves.current.delete(path);
      });
      inFlightSaves.current.set(path, promise);
      return promise;
    },
    []
  );

  const saveAllFiles = useCallback(async () => {
    // Recompute dirty files between saves: each saveFile changes openFiles,
    // so snapshotting the list once would save stale content for later
    // files in the loop.
    for (;;) {
      const nextDirty = openFilesRef.current.find(
        (f) => f.content !== f.currentContent
      );
      if (!nextDirty) return;
      await saveFile(nextDirty.path);
    }
  }, [saveFile]);

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
