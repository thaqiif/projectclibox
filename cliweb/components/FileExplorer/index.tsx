"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { FileTabs } from "./FileTabs";
import type { UseFileEditorReturn } from "@/hooks/useFileEditor";
import { useViewport } from "@/hooks/useViewport";
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  EyeOff,
  File,
  Folder,
  Loader2,
  RefreshCw,
  Check,
  Save,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FileNode } from "@/lib/file-utils";
import { matchesFilter } from "@/lib/file-utils";
import type { OpenFile } from "@/hooks/useFileEditor";
import { FileOpsMenu } from "./TreeNodeActions";
import { BulkActionBar } from "./BulkActionBar";
import { clearSelection, toggleSelection, applySelectAllToggle } from "@/lib/file-bulk";
import { fileRename, fileDelete, fileRestore } from "@/lib/file-ops";
import { onUploadComplete, uploadFileToTemp } from "@/lib/file-upload";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useFileUploadProgress } from "@/hooks/useFileUploadProgress";
import { ListFilter } from "./ListFilter";
import { UploadProgressBanner } from "./UploadProgressBanner";
import { SaveConflictDialog } from "./SaveConflictDialog";
import { UNDO_WINDOW_MS } from "./TreeNodeActions";

// The CodeMirror stack is heavy and only loads once a file is actually
// opened, not when the explorer pane first appears.
const FileEditor = dynamic(
  () => import("./FileEditor").then((m) => m.FileEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center gap-2">
        <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
        <span className="ui-label">Loading</span>
      </div>
    ),
  }
);

interface FileExplorerProps {
  workingDirectory: string;
  fileEditor: UseFileEditorReturn;
  /** Choose the compact tree/editor flow from this explorer's own width. */
  responsiveToContainer?: boolean;
}

export function FileExplorer({
  workingDirectory,
  fileEditor,
  responsiveToContainer = false,
}: FileExplorerProps) {
  const { isMobile: isViewportMobile, isHydrated } = useViewport();
  const explorerRef = useRef<HTMLDivElement>(null);
  const [containerIsMobile, setContainerIsMobile] = useState<boolean | null>(
    null
  );
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  // Drill-down navigation: current directory being browsed (null = workingDirectory)
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  // Show dotfiles; persisted in localStorage
  const [showHidden, setShowHidden] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!responsiveToContainer) return;
    const element = explorerRef.current;
    if (!element) return;

    const updateLayout = () => {
      const nextIsMobile = element.clientWidth < 768;
      setContainerIsMobile((current) =>
        current === nextIsMobile ? current : nextIsMobile
      );
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(element);
    return () => observer.disconnect();
  }, [responsiveToContainer]);

  const isMobile = responsiveToContainer
    ? containerIsMobile === true
    : isViewportMobile;
  const isLayoutReady =
    isHydrated && (!responsiveToContainer || containerIsMobile !== null);

  // Load persisted hidden-files preference once hydrated on the client
  useEffect(() => {
    try {
      setShowHidden(localStorage.getItem("files-show-hidden") === "true");
    } catch {
      // localStorage unavailable, keep default
    }
  }, []);

  const handleToggleHidden = useCallback(() => {
    setShowHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("files-show-hidden", String(next));
      } catch {
        // localStorage unavailable, ignore
      }
      return next;
    });
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Terminal drops and paste-as-file create <cwd>/tmp outside this component.
  // Refresh successful uploads so the new tmp folder appears without reload.
  useEffect(() => onUploadComplete(handleRefresh), [handleRefresh]);

  // FILTER_INTEGRATION: basename substring filter over the listing
  const [filter, setFilter] = useState("");
  const filteredFiles = useMemo(
    () => (filter.trim() ? files.filter((n) => matchesFilter(n, filter)) : files),
    [files, filter]
  );


  // Breadcrumb segments for the current dir (root first, null path = root).
  const breadcrumbs = useMemo(() => {
    const root = workingDirectory.replace(/\/+$/, "");
    const isRoot = !(currentDir && currentDir.replace(/\/+$/, "") !== root);
    const segments = [{ name: root.split("/").pop() || root, path: null as string | null }];
    if (!isRoot && currentDir) {
      const rel = currentDir.length > root.length ? currentDir.slice(root.length + 1) : "";
      rel.split("/").filter(Boolean).forEach((part, i, arr) => {
        segments.push({ name: part, path: `${root}/${arr.slice(0, i + 1).join("/")}` });
      });
    }
    return segments;
  }, [workingDirectory, currentDir]);

  const handleNavigateTo = useCallback((dir: string | null) => {
    setCurrentDir(dir);
  }, []);

  const {
    openFiles,
    activeFilePath,
    loading: fileLoading,
    saving,
    saveError,
    openFile,
    closeFile,
    setActiveFile,
    updateContent,
    saveFile,
    conflictFilePath,
    conflictServerMtimeMs,
    reloadConflictedFile,
    dismissConflict,
    isDirty,
    getFile,
  } = fileEditor;

  const handleConflictOverwrite = useCallback(async () => {
    if (conflictFilePath) {
      await saveFile(conflictFilePath, {
        force: true,
        // The user explicitly confirmed the overwrite in the conflict
        // dialog: this is the only path allowed to replace a text open
        // whose on-disk bytes became binary. A plain save never sends it.
        allowBinaryOverwrite: true,
      });
      dismissConflict();
    }
  }, [conflictFilePath, saveFile, dismissConflict]);

  const handleConflictReload = useCallback(async () => {
    if (conflictFilePath) {
      await reloadConflictedFile(conflictFilePath);
      dismissConflict();
    }
  }, [conflictFilePath, reloadConflictedFile, dismissConflict]);

  const effectiveDir = currentDir ?? workingDirectory;

  // Reset navigation when the terminal working directory changes
  useEffect(() => {
    setCurrentDir(null);
  }, [workingDirectory]);

  // Load directory contents
  useEffect(() => {
    const loadFiles = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/files?path=${encodeURIComponent(effectiveDir)}&showHidden=${showHidden}`
        );
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setFiles(data.files || []);
        }
      } catch {
        setError("Failed to load directory");
      } finally {
        setLoading(false);
      }
    };
    loadFiles();
  }, [workingDirectory, effectiveDir, showHidden, refreshKey]);

  const handleOpenDir = useCallback((path: string) => {
    setCurrentDir(path);
  }, []);

  const handleNavigateUp = useCallback(() => {
    setCurrentDir((prev) => {
      const dir = prev ?? workingDirectory;
      if (dir === workingDirectory) return null;
      const parent = dir.split("/").slice(0, -1).join("/");
      // Don't navigate above the terminal working directory
      const p = workingDirectory.split("/").slice(0, -1).join("/");
      if (!parent || parent === p) return null;
      if (dir.startsWith(workingDirectory)) return parent;
      return null;
    });
  }, [workingDirectory]);

  const handleFileClick = useCallback(
    (path: string) => {
      openFile(path);
    },
    [openFile]
  );

  const handleCloseFile = useCallback(
    (path: string) => {
      if (isDirty(path)) {
        setPendingClose(path);
      } else {
        closeFile(path);
      }
    },
    [isDirty, closeFile]
  );

  const handleConfirmClose = useCallback(async () => {
    if (!pendingClose) return;
    closeFile(pendingClose);
    setPendingClose(null);
  }, [pendingClose, closeFile]);

  const handleSaveAndClose = useCallback(async () => {
    if (!pendingClose) return;
    const result = await saveFile(pendingClose);
    if (!result.ok) {
      // Save failed: keep the tab open and show the error (via saveError)
      // so edits are not lost. Dismiss the dialog so the banner is visible.
      setPendingClose(null);
      return;
    }
    closeFile(pendingClose);
    setPendingClose(null);
  }, [pendingClose, saveFile, closeFile]);

  const handleSave = useCallback(async () => {
    if (activeFilePath) {
      await saveFile(activeFilePath);
    }
  }, [activeFilePath, saveFile]);

  // CLOSE_ALL: close every open tab; confirm first when any tab is dirty.
  const dirtyCount = openFiles.filter((f) => f.content !== f.currentContent)
    .length;
  const [pendingCloseAll, setPendingCloseAll] = useState(false);
  const handleCloseAll = useCallback(() => {
    if (openFiles.length === 0) return;
    if (openFiles.some((f) => f.content !== f.currentContent)) {
      setPendingCloseAll(true);
      return;
    }
    openFiles.forEach((f) => closeFile(f.path));
  }, [openFiles, closeFile]);
  const handleConfirmCloseAll = useCallback(() => {
    openFiles.forEach((f) => closeFile(f.path));
    setPendingCloseAll(false);
  }, [openFiles, closeFile]);

  const activeFile = activeFilePath ? getFile(activeFilePath) : undefined;

  // Only show the save error for the file the user failed to save; switching
  // files hides it again.
  const [dismissedSaveErrorFor, setDismissedSaveErrorFor] = useState<
    string | null
  >(null);
  // A new save failure re-shows the banner, even if the user dismissed the
  // previous one.
  useEffect(() => {
    if (saveError !== null) setDismissedSaveErrorFor(null);
  }, [saveError]);
  const visibleSaveError =
    activeFilePath && saveError !== null && dismissedSaveErrorFor !== activeFilePath
      ? saveError
      : null;

  // Loading state before hydration
  if (!isLayoutReady) {
    return (
      <div
        ref={explorerRef}
        className="bg-background flex h-full w-full items-center justify-center"
      >
        <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
      </div>
    );
  }

  // Mobile layout: full-screen tree OR full-screen editor
  if (isMobile) {
    return (
      <div
        ref={explorerRef}
        className="relative h-full min-h-0 min-w-0 w-full overflow-hidden"
      >
        <MobileFileExplorer
          files={filteredFiles}
          loading={loading}
          error={error}
          fileLoading={fileLoading}
          workingDirectory={effectiveDir}
          openFiles={openFiles}
          activeFilePath={activeFilePath}
          activeFile={activeFile}
          saving={saving}
          onFileClick={handleFileClick}
          onOpenDir={handleOpenDir}
          canGoUp={currentDir !== null}
          onGoUp={handleNavigateUp}
          breadcrumbs={breadcrumbs}
          onNavigateTo={handleNavigateTo}
          showHidden={showHidden}
          onToggleHidden={handleToggleHidden}
          onRefresh={handleRefresh}
          onSelectTab={setActiveFile}
          onCloseTab={handleCloseFile}
          onSave={handleSave}
          onBack={() => setActiveFile(null as unknown as string)}
          isDirty={isDirty}
          updateContent={updateContent}
          pendingClose={pendingClose}
          onCancelClose={() => setPendingClose(null)}
          onConfirmClose={handleConfirmClose}
          onSaveAndClose={handleSaveAndClose}
          saveError={visibleSaveError}
          onDismissSaveError={() => setDismissedSaveErrorFor(activeFilePath)}
          conflictFilePath={conflictFilePath}
          onCloseAll={handleCloseAll}
          filter={filter}
          onFilterChange={setFilter}
        />
        <CloseAllDialog
          open={pendingCloseAll}
          count={dirtyCount}
          onCancel={() => setPendingCloseAll(false)}
          onConfirm={handleConfirmCloseAll}
        />
      </div>
    );
  }

  // Desktop layout: side-by-side tree + editor
  return (
    <div
      ref={explorerRef}
      className="h-full min-h-0 min-w-0 w-full overflow-hidden"
    >
      <DesktopFileExplorer
        files={filteredFiles}
        loading={loading}
        error={error}
        fileLoading={fileLoading}
        workingDirectory={effectiveDir}
        openFiles={openFiles}
        activeFilePath={activeFilePath}
        activeFile={activeFile}
        saving={saving}
        onFileClick={handleFileClick}
        onOpenDir={handleOpenDir}
        canGoUp={currentDir !== null}
        onGoUp={handleNavigateUp}
        breadcrumbs={breadcrumbs}
        onNavigateTo={handleNavigateTo}
        showHidden={showHidden}
        onToggleHidden={handleToggleHidden}
        onRefresh={handleRefresh}
        onSelectTab={setActiveFile}
        onCloseTab={handleCloseFile}
        onSave={handleSave}
        isDirty={isDirty}
        updateContent={updateContent}
        pendingClose={pendingClose}
        onCancelClose={() => setPendingClose(null)}
        onConfirmClose={handleConfirmClose}
        onSaveAndClose={handleSaveAndClose}
        saveError={visibleSaveError}
        onDismissSaveError={() => setDismissedSaveErrorFor(activeFilePath)}
        conflictFilePath={conflictFilePath}
        onConflictOverwrite={handleConflictOverwrite}
        onConflictReload={handleConflictReload}
        onDismissConflict={dismissConflict}
        onCloseAll={handleCloseAll}
        filter={filter}
        onFilterChange={setFilter}
      />
      <CloseAllDialog
        open={pendingCloseAll}
        count={dirtyCount}
        onCancel={() => setPendingCloseAll(false)}
        onConfirm={handleConfirmCloseAll}
      />
    </div>
  );
}

// Desktop: Side-by-side tree + editor
interface DesktopFileExplorerProps {
  files: FileNode[];
  loading: boolean;
  error: string | null;
  fileLoading: boolean;
  workingDirectory: string;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  activeFile: OpenFile | undefined;
  saving: boolean;
  onFileClick: (path: string) => void;
  onOpenDir: (path: string) => void;
  canGoUp: boolean;
  onGoUp: () => void;
  breadcrumbs: { name: string; path: string | null }[];
  onNavigateTo: (dir: string | null) => void;
  showHidden: boolean;
  onToggleHidden: () => void;
  onRefresh: () => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSave: () => void;
  isDirty: (path: string) => boolean;
  updateContent: (path: string, content: string) => void;
  pendingClose: string | null;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  onSaveAndClose: () => void;
  saveError: string | null;
  onDismissSaveError: () => void;
  conflictFilePath?: string | null;
  onConflictOverwrite?: () => Promise<void> | void;
  onConflictReload?: () => Promise<void> | void;
  onDismissConflict?: () => void;
  onCloseAll?: () => void;
  filter?: string;
  onFilterChange?: (value: string) => void;
}

function DesktopFileExplorer({
  files,
  loading,
  error,
  fileLoading,
  workingDirectory,
  openFiles,
  activeFilePath,
  activeFile,
  saving,
  onFileClick,
  onOpenDir,
  canGoUp,
  onGoUp,
  breadcrumbs,
  onNavigateTo,
  showHidden,
  onToggleHidden,
  onRefresh,
  onSelectTab,
  onCloseTab,
  onSave,
  isDirty,
  updateContent,
  pendingClose,
  onCancelClose,
  onConfirmClose,
  onSaveAndClose,
  saveError,
  onDismissSaveError,
  conflictFilePath,
  onConflictOverwrite,
  onConflictReload,
  onDismissConflict,
  onCloseAll,
  filter,
  onFilterChange,
}: DesktopFileExplorerProps) {
  const [treeWidth, setTreeWidth] = useState(280);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      setTreeWidth(Math.max(200, Math.min(500, newWidth)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  return (
    <div ref={containerRef} className="bg-background flex h-full w-full">
      {/* File tree panel */}
      {/* relative anchors the upload banner's absolute positioning to this
          panel; without it the banner climbs to the nearest positioned
          ancestor and overflows a monitor pane hosting this explorer. */}
      <div
        className="bg-background relative flex h-full min-w-0 shrink-0 flex-col"
        style={{ width: treeWidth }}
      >
        <div className="glass glass-edge-bottom relative z-10 flex h-9 shrink-0 items-center gap-1.5 px-2">
          {canGoUp && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onGoUp}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Go back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          )}
          <span className="ui-label shrink-0">Files</span>
          <ExplorerBreadcrumb breadcrumbs={breadcrumbs} onNavigateTo={onNavigateTo} />
          <ExplorerListButtons
            showHidden={showHidden}
            onToggleHidden={onToggleHidden}
            onRefresh={onRefresh}
          />
        </div>
        {/* FILTER_INTEGRATION: filter input above listing */}
        {onFilterChange && (
          <div className="shrink-0 px-2 py-1">
            <ListFilter value={filter ?? ""} onChange={onFilterChange} />
          </div>
        )}
        <ListingBody
          files={files}
          loading={loading}
          error={error}
          workingDirectory={workingDirectory}
          onOpenDir={onOpenDir}
          onFileClick={onFileClick}
          onRefresh={onRefresh}
          activePath={activeFilePath ?? undefined}
        />
        {/* UPLOAD_PROGRESS_INTEGRATION: aggregate upload progress */}
        <UploadProgressBanner className="absolute bottom-2 left-2 right-2 z-20" />
      </div>

      {/* Resize handle */}
      <div className="bg-border relative w-px shrink-0 transition-colors hover:bg-primary active:bg-primary">
        <div
          className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize"
          onMouseDown={handleMouseDown}
        />
      </div>

      {/* Editor panel */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Tabs */}
        {openFiles.length > 0 && (
          <FileTabs
            files={openFiles}
            activeFilePath={activeFilePath}
            onSelect={onSelectTab}
            onClose={onCloseTab}
            isDirty={isDirty}
            onCloseAll={onCloseAll}
          />
        )}

        {/* Save error banner */}
        {saveError && (
          <SaveErrorBanner message={saveError} onDismiss={onDismissSaveError} />
        )}

        {/* Editor or empty state */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {fileLoading ? (
            <div className="flex h-full items-center justify-center gap-2">
              <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
              <span className="ui-label">Loading</span>
            </div>
          ) : activeFile ? (
            <FileEditor
              path={activeFile.path}
              content={activeFile.currentContent}
              language={activeFile.language}
              isBinary={activeFile.isBinary}
              truncated={activeFile.truncated}
              dirty={activeFilePath ? isDirty(activeFilePath) : false}
              saving={saving}
              onChange={(content) => updateContent(activeFile.path, content)}
              onSave={onSave}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <p className="ui-label">No file open</p>
              <p className="ui-meta">no file open</p>
              <p className="ui-meta text-muted-foreground/70">
                ❯ select a file from the tree
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Unsaved changes dialog */}
      <UnsavedChangesDialog
        open={!!pendingClose}
        fileName={pendingClose?.split("/").pop() || ""}
        onCancel={onCancelClose}
        onDiscard={onConfirmClose}
        onSave={onSaveAndClose}
      />
      {/* Save conflict dialog */}
      {conflictFilePath && onConflictOverwrite && onConflictReload && onDismissConflict && (
        <SaveConflictDialog
          open
          fileName={conflictFilePath.split("/").pop() || conflictFilePath}
          onOverwrite={onConflictOverwrite}
          onReload={onConflictReload}
          onCancel={onDismissConflict}
        />
      )}
    </div>
  );
}

interface MobileFileExplorerProps extends DesktopFileExplorerProps {
  onBack: () => void;
}

function MobileFileExplorer({
  files,
  loading,
  error,
  fileLoading,
  workingDirectory,
  openFiles,
  activeFilePath,
  activeFile,
  saving,
  onFileClick,
  onOpenDir,
  canGoUp,
  onGoUp,
  breadcrumbs,
  onNavigateTo,
  showHidden,
  onToggleHidden,
  onRefresh,
  onSelectTab,
  onCloseTab,
  onSave,
  onBack,
  isDirty,
  updateContent,
  pendingClose,
  onCancelClose,
  onConfirmClose,
  onSaveAndClose,
  saveError,
  onDismissSaveError,
  conflictFilePath,
  onConflictOverwrite,
  onConflictReload,
  onDismissConflict,
  onCloseAll,
  filter,
  onFilterChange,
}: MobileFileExplorerProps) {
  // Show editor when a file is active
  if (activeFile) {
    const isCurrentDirty = activeFilePath ? isDirty(activeFilePath) : false;

    return (
      <div className="bg-background flex h-full w-full flex-col">
        {/* Header */}
        <div className="glass glass-edge-bottom relative z-10 flex h-10 shrink-0 items-center gap-1 pr-1 pl-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <FileTabs
              files={openFiles}
              activeFilePath={activeFilePath}
              onSelect={onSelectTab}
              onClose={onCloseTab}
              isDirty={isDirty}
              onCloseAll={onCloseAll}
            />
          </div>
          {isCurrentDirty && (
            <Button
              variant="default"
              size="sm"
              onClick={onSave}
              disabled={saving}
              className=""
            >
              <Save className="h-3 w-3" />
              save
            </Button>
          )}
        </div>

        {/* Save error banner */}
        {saveError && (
          <SaveErrorBanner message={saveError} onDismiss={onDismissSaveError} />
        )}

        {/* Editor */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {fileLoading ? (
            <div className="flex h-full items-center justify-center gap-2">
              <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
              <span className="ui-label">Loading</span>
            </div>
          ) : (
            <FileEditor
              path={activeFile.path}
              content={activeFile.currentContent}
              language={activeFile.language}
              isBinary={activeFile.isBinary}
              truncated={activeFile.truncated}
              dirty={isCurrentDirty}
              saving={saving}
              onChange={(content) => updateContent(activeFile.path, content)}
              onSave={onSave}
            />
          )}
        </div>

        {/* Unsaved changes dialog */}
        <UnsavedChangesDialog
          open={!!pendingClose}
          fileName={pendingClose?.split("/").pop() || ""}
          onCancel={onCancelClose}
          onDiscard={onConfirmClose}
          onSave={onSaveAndClose}
        />
        {/* Save conflict dialog */}
        {conflictFilePath && onConflictOverwrite && onConflictReload && onDismissConflict && (
          <SaveConflictDialog
            open
            fileName={conflictFilePath.split("/").pop() || conflictFilePath}
            onOverwrite={onConflictOverwrite}
            onReload={onConflictReload}
            onCancel={onDismissConflict}
          />
        )}
      </div>
    );
  }

  // Show file tree
  return (
    <div className="bg-background relative flex h-full w-full flex-col">
      <div className="glass glass-edge-bottom relative z-10 flex h-12 shrink-0 flex-col justify-center gap-0.5 px-3">
        <span className="ui-label">Files</span>
        <ExplorerBreadcrumb breadcrumbs={breadcrumbs} onNavigateTo={onNavigateTo} />
        <div className="absolute top-0 right-0 flex items-center pr-1">
          {canGoUp && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onGoUp}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Go back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <ExplorerListButtons
            showHidden={showHidden}
            onToggleHidden={onToggleHidden}
            onRefresh={onRefresh}
          />
        </div>
      </div>

      {/* FILTER_INTEGRATION: filter input above listing */}
      {onFilterChange && (
        <div className="shrink-0 px-2 py-1">
          <ListFilter value={filter ?? ""} onChange={onFilterChange} />
        </div>
      )}

      <ListingBody
        files={files}
        loading={loading}
        error={error}
        workingDirectory={workingDirectory}
        onOpenDir={onOpenDir}
        onFileClick={onFileClick}
        onRefresh={onRefresh}
        activePath={activeFilePath ?? undefined}
      />

      {fileLoading && (
        <div className="bg-background/80 absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <Loader2 className="text-primary h-6 w-6 animate-spin" />
        </div>
      )}
      {/* UPLOAD_PROGRESS_INTEGRATION: aggregate upload progress; anchored
          below the listing instead of overlapping the BulkActionBar with an
          absolutely-positioned viewport-wide strip. */}
      <div className="shrink-0 px-2 pb-2">
        <UploadProgressBanner />
      </div>
    </div>
  );
}

// Eye/eye-off and refresh controls shared by the desktop and mobile headers
function ExplorerListButtons({
  showHidden,
  onToggleHidden,
  onRefresh,
}: {
  showHidden: boolean;
  onToggleHidden: () => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggleHidden}
        className="text-muted-foreground hover:text-foreground"
        aria-label={showHidden ? "Hide hidden files" : "Show hidden files"}
      >
        {showHidden ? (
          <Eye className="h-3.5 w-3.5" />
        ) : (
          <EyeOff className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRefresh}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Refresh"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}

// Clickable path segments: root (workingDirectory basename) > each subdir.
function ExplorerBreadcrumb({
  breadcrumbs,
  onNavigateTo,
}: {
  breadcrumbs: { name: string; path: string | null }[];
  onNavigateTo: (dir: string | null) => void;
}) {
  return (
    <nav
      aria-label="Directory path"
      className="ui-meta flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
    >
      {breadcrumbs.map((seg, i) => {
        const last = i === breadcrumbs.length - 1;
        return (
          <span
            key={seg.path ?? "root"}
            className="flex min-w-0 items-center gap-0.5"
          >
            {i > 0 && (
              <ChevronRight className="text-muted-foreground/50 h-3 w-3 shrink-0" />
            )}
            <button
              type="button"
              disabled={last}
              onClick={() => onNavigateTo(seg.path)}
              className={cn(
                "truncate",
                last
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground cursor-pointer"
              )}
              title={seg.path ?? seg.name}
            >
              {seg.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

// Drill-down directory listing: clicking a folder replaces the listing with
// its contents; back button in the header navigates up.
interface ListingBodyProps {
  files: FileNode[];
  loading: boolean;
  error: string | null;
  workingDirectory: string;
  onOpenDir: (path: string) => void;
  onFileClick: (path: string) => void;
  onRefresh?: () => void;
  activePath?: string;
  /** True when a filter term is active, for accurate empty-state copy. */
  filterActive?: boolean;
}

function ListingBody({
  files,
  loading,
  error,
  workingDirectory,
  onOpenDir,
  onFileClick,
  onRefresh,
  activePath,
  filterActive = false,
}: ListingBodyProps) {
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  // Minimal multi-select wiring: checkbox per row, selection owned here and
  // consumed by the floating BulkActionBar. Coordinator may lift this later.
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // TRASH_UNDO: undo banners live here (the listing) rather than in the
  // per-row FileOpsMenu, because the refresh after trashing removes the row
  // and unmounts the menu, destroying its banner before Undo could be
  // used. A queue of entries keeps Undo available for every item trashed
  // within its 10s window, not just the most recent one.
  const { uploading } = useFileUploadProgress();
  const hasSelection = selectedPaths.size > 0;
  const [trashQueue, setTrashQueue] = useState<TrashEntry[]>([]);
  const [undoBusyId, setUndoBusyId] = useState<number | null>(null);
  const nextTrashId = useRef(1);

  const handleTrashed = useCallback((name: string, trashPath: string) => {
    const id = nextTrashId.current++;
    setTrashQueue((prev) => [
      ...prev,
      { id, name, trashPath, expiresAt: Date.now() + UNDO_WINDOW_MS },
    ]);
  }, []);

  const removeTrashEntry = useCallback((id: number) => {
    setTrashQueue((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleUndoTrash = useCallback(
    async (entry: TrashEntry) => {
      if (undoBusyId !== null) return; // rapid double-click guard
      setUndoBusyId(entry.id);
      try {
        await fileRestore(entry.trashPath);
        removeTrashEntry(entry.id);
        onRefresh?.(); // restore re-adds the item, so refresh the listing
      } catch (err) {
        console.error("Restore failed:", err);
        window.alert(
          err instanceof Error
            ? err.message
            : "Restore failed; the item stays in trash"
        );
      } finally {
        setUndoBusyId(null);
      }
    },
    [undoBusyId, onRefresh, removeTrashEntry]
  );

  // DND_UPLOAD: accept OS file drops into the listing and upload them into
  // the directory currently shown. The enabled gate ("Files" type) keeps
  // this hook out of the internal row-move drags, which carry text/plain.
  const listingRef = useRef<HTMLDivElement>(null);
  const handleDroppedFile = useCallback(
    async (file: File) => {
      await uploadFileToTemp(file, {
        targetDir: workingDirectory,
        // The browsed folder must already exist: never recreate a directory
        // the user just deleted, and never invent one they are not looking at.
        createTargetDir: false,
      });
    },
    [workingDirectory]
  );
  const { isDragging: isFileDrag, dragHandlers: fileDragHandlers } =
    useFileDrop(listingRef, handleDroppedFile, {
      enabled: (e) => e.dataTransfer.types.includes("Files"),
    });

  // Selection refers to paths in the listing; start fresh when navigating.
  // Derived-reset pattern: adjust state during render instead of an effect.
  // clearSelection() (not a bare new Set()) keeps this reset on the same
  // model helper as every other clear path.
  const [prevWorkingDir, setPrevWorkingDir] = useState(workingDirectory);
  if (prevWorkingDir !== workingDirectory) {
    setPrevWorkingDir(workingDirectory);
    setSelectedPaths(clearSelection());
  }

  // Move node A into directory B via rename op (full destination path).
  const handleDropMove = useCallback(
    async (srcPath: string, destDirPath: string) => {
      const base = srcPath.replace(/\/+$/, "").split("/").pop() || srcPath;
      const cleanDest = destDirPath.replace(/\/+$/, "");
      if (srcPath === cleanDest) return;
      // Refuse moving a directory into itself or its own subtree
      if (
        cleanDest.startsWith(srcPath.replace(/\/+$/, "") + "/")
      ) {
        window.alert(`Cannot move "${base}" into itself or its own subtree`);
        return;
      }
      try {
        await fileRename(srcPath, `${cleanDest}/${base}`);
        onRefresh?.();
      } catch (err) {
        console.error("Move failed:", err);
        window.alert(err instanceof Error ? err.message : "Move failed");
      }
    },
    [onRefresh]
  );

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, node: FileNode) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const row = e.currentTarget;
        const rows = Array.from(
          row.parentElement?.querySelectorAll<HTMLDivElement>("[role=button]") ?? []
        );
        const idx = rows.indexOf(row);
        const next = rows[idx + (e.key === "ArrowDown" ? 1 : -1)];
        next?.focus();
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (node.type === "directory") onOpenDir(node.path);
        else onFileClick(node.path);
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        const name = window.prompt("New name:", node.name);
        if (!name || name === node.name) return;
        const parent = node.path.slice(0, node.path.lastIndexOf("/")) || "/";
        fileRename(node.path, `${parent.replace(/\/+$/, "")}/${name}`)
          .then(() => onRefresh?.())
          .catch((err) => {
            console.error("Rename failed:", err);
            window.alert(err instanceof Error ? err.message : "Rename failed");
          });
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        if (
          !window.confirm(
            `Delete "${node.name}"${node.type === "directory" ? " (and all contents)" : ""}? This cannot be undone.`
          )
        )
          return;
        fileDelete(node.path)
          .then(() => onRefresh?.())
          .catch((err) => {
            console.error("Delete failed:", err);
            window.alert(err instanceof Error ? err.message : "Delete failed");
          });
      }
    },
    [onOpenDir, onFileClick, onRefresh]
  );

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center gap-2">
        <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
        <span className="ui-label">Loading</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 p-4">
        <span className="text-destructive ui-label">Couldn&apos;t load</span>
        <p className="ui-meta text-center">{error}</p>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2">
        <p className="ui-label">Nothing here</p>
        <p className="ui-meta">
          {filterActive
            ? "no matches for the filter"
            : "directory has no entries"}
        </p>
      </div>
    );
  }

  // Select-all header: state derived from the rows CURRENTLY LISTED (they
  // arrive pre-filtered from the parent), so the checkbox only reflects what
  // select-all can actually affect. "some" renders as the indeterminate
  // (mixed) state; clicking mixed or fully-selected clears everything.
  const listedPaths = files.map((node) => node.path);
  const selectedListedCount = listedPaths.reduce(
    (acc, path) => acc + (selectedPaths.has(path) ? 1 : 0),
    0
  );
  const allListedSelected = selectedListedCount === listedPaths.length;
  const someListedSelected = selectedListedCount > 0 && !allListedSelected;

  return (
    <div
      ref={listingRef}
      {...fileDragHandlers}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      {isFileDrag && (
        <div className="bg-background/60 ring-primary pointer-events-none absolute inset-0 z-10 flex items-center justify-center ring-1 ring-inset">
          <span className="bg-background text-foreground ui-label px-2 py-1">
            drop to upload into this folder
          </span>
        </div>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={someListedSelected ? "mixed" : allListedSelected}
        aria-label={
          allListedSelected || someListedSelected
            ? "Clear selection"
            : "Select all listed items"
        }
        tabIndex={0}
        // No onKeyDown toggle here: a native <button> synthesizes click on
        // Enter and Space, so a keydown handler would run the toggle twice
        // per key press (keydown, then the synthesized click) — selecting
        // and immediately clearing in one gesture. The click handler alone
        // is keyboard-complete.
        onClick={() =>
          setSelectedPaths((prev) => applySelectAllToggle(listedPaths, prev))
        }
        className={cn(
          // Whole row is the control: the 14px square alone is too small a
          // tap target on mobile. Matches the row height/indent of the
          // listing below and sits above the scroll area, so it never
          // scrolls away (sticky-ish).
          "flex h-10 w-full shrink-0 items-center gap-1.5 border-b border-border/60 pr-3 pl-2 text-left transition-colors hover:bg-[var(--fill-4)] md:h-7",
          (allListedSelected || someListedSelected) && "bg-[var(--fill-4)]"
        )}
      >
        <span
          className={cn(
            "flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border transition-opacity",
            (allListedSelected || someListedSelected)
              ? "border-primary bg-primary text-primary-foreground opacity-100"
              : "border-input opacity-70"
          )}
        >
          {someListedSelected ? (
            // Indeterminate dash, mirroring the partChecked styling pattern.
            <span className="h-0.5 w-2 rounded-full bg-current" />
          ) : (
            allListedSelected && <Check className="h-2.5 w-2.5" />
          )}
        </span>
        <span className="ui-meta truncate text-muted-foreground">
          {someListedSelected
            ? `${selectedListedCount} of ${listedPaths.length} selected`
            : allListedSelected
              ? `${listedPaths.length} selected`
              : "Select all"}
        </span>
      </button>
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <div className="py-1">
        {files.map((node) => {
          const isDirectory = node.type === "directory";
          const isActive = activePath === node.path;

          return (
            <div
              key={node.path}
              role="button"
              tabIndex={0}
              onClick={() =>
                isDirectory ? onOpenDir(node.path) : onFileClick(node.path)
              }
          onKeyDown={(e) => handleRowKeyDown(e, node)}
          draggable={true}
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", node.path);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            // OS file drags belong to the listing-level upload drop, not
            // the row-move gesture.
            if (!isDirectory || e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOverPath(node.path);
          }}
          onDragLeave={(e) => {
            if (!isDirectory || e.dataTransfer.types.includes("Files")) return;
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOverPath((prev) => (prev === node.path ? null : prev));
          }}
          onDrop={async (e) => {
            if (!isDirectory || e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragOverPath(null);
            const src = e.dataTransfer.getData("text/plain");
            if (!src) return;
            await handleDropMove(src, node.path);
          }}
          className={cn(
            "group/node group relative flex h-10 w-full cursor-pointer items-center gap-1.5 pr-3 pl-2 text-left transition-colors hover:bg-[var(--fill-4)] md:h-7",
            isActive && "bg-[var(--fill-3)]",
            isDirectory && dragOverPath === node.path &&
              "bg-[var(--fill-3)] ring-1 ring-primary ring-inset"
          )}
            >
              {isActive && (
                <span className="bg-primary absolute inset-y-0 left-0 w-0.5" />
              )}

              <button
                type="button"
                role="checkbox"
                aria-checked={selectedPaths.has(node.path)}
                aria-label={`Select ${node.name}`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedPaths((prev) => toggleSelection(prev, node.path));
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPaths((prev) => toggleSelection(prev, node.path));
                }}
                className={cn(
                  "flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border transition-opacity",
                  selectedPaths.has(node.path)
                    ? "border-primary bg-primary text-primary-foreground opacity-100"
                    : "border-input opacity-0 hover:bg-accent group-hover/node:opacity-100"
                )}
              >
                {selectedPaths.has(node.path) && (
                  <Check className="h-2.5 w-2.5" />
                )}
              </button>

              <span className="flex-shrink-0">
                {isDirectory ? (
                  <Folder className="text-muted-foreground h-3.5 w-3.5" />
                ) : (
                  <File className="text-muted-foreground h-3.5 w-3.5 opacity-70" />
                )}
              </span>

              <span
                className={cn(
                  "flex-1 truncate font-mono text-xs",
                  isDirectory ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {node.name}
              </span>

              {!isDirectory && node.size !== undefined && (
                <span className="ui-meta hidden flex-shrink-0 text-[10px] md:block">
                  {formatFileSize(node.size)}
                </span>
              )}

              <span className="flex-shrink-0">
                <FileOpsMenu
                  node={node}
                  workingDirectory={workingDirectory}
                  onDone={onRefresh}
                  onTrashed={handleTrashed}
                />
              </span>
            </div>
          );
        })}
        </div>
      </div>

      <BulkActionBar
        selectedPaths={Array.from(selectedPaths)}
        workingDirectory={workingDirectory}
        allSelected={allListedSelected}
        onRefresh={onRefresh}
        onClear={() => setSelectedPaths(clearSelection())}
      />

      {trashQueue.length > 0 &&
        createPortal(
          // Stacked undo banners, anchored above the bulk bar / upload
          // banner so all three can be on screen without overlapping.
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "fixed left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2",
              uploading
                ? hasSelection
                  ? "bottom-28"
                  : "bottom-16"
                : hasSelection
                  ? "bottom-14"
                  : "bottom-4"
            )}
          >
            {trashQueue.map((entry) => (
              <TrashUndoBannerRow
                key={entry.id}
                entry={entry}
                busy={undoBusyId === entry.id}
                onUndo={() => void handleUndoTrash(entry)}
                onExpire={() => removeTrashEntry(entry.id)}
                onDismiss={() => removeTrashEntry(entry.id)}
              />
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

interface TrashEntry {
  id: number;
  name: string;
  trashPath: string;
  expiresAt: number;
}

function TrashUndoBannerRow({
  entry,
  busy,
  onUndo,
  onExpire,
  onDismiss,
}: {
  entry: TrashEntry;
  busy: boolean;
  onUndo: () => void;
  onExpire: () => void;
  onDismiss: () => void;
}) {
  // Auto-dismiss when the undo window elapses (the same window the server
  // purges after; an Undo racing the purge fails with a clear alert).
  useEffect(() => {
    const timer = setTimeout(
      onExpire,
      Math.max(entry.expiresAt - Date.now(), 0)
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur">
      <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="max-w-[40ch] truncate text-sm">
        Moved “{entry.name}” to trash
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onUndo}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Undo2 className="h-3 w-3" />
        )}
        Undo
      </button>
      <button
        type="button"
        aria-label="Dismiss undo banner"
        onClick={onDismiss}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// Dismissible inline banner for a failed save. No toast lib: a small inline
// error strip in the editor header area.
interface SaveErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

function SaveErrorBanner({ message, onDismiss }: SaveErrorBannerProps) {
  return (
    <div
      role="alert"
      className="bg-destructive/10 text-destructive ui-meta flex items-center gap-2 border-b border-b-destructive/20 px-3 py-1.5"
    >
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss save error"
        className="text-destructive/80 hover:text-destructive flex-shrink-0 cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Close-all confirmation: shown when at least one open tab is dirty.
// Confirming discards the unsaved changes and closes every tab.
interface CloseAllDialogProps {
  open: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}

function CloseAllDialog({ open, count, onCancel, onConfirm }: CloseAllDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen: boolean) => !isOpen && onCancel()}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <span className="ui-label">Unsaved changes</span>
          <DialogTitle className="type-title-3">Close all files</DialogTitle>
          <DialogDescription>
            {count} {count === 1 ? "file has" : "files have"} unsaved changes.
            Discard and close all?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Close all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Unsaved changes confirmation dialog
interface UnsavedChangesDialogProps {
  open: boolean;
  fileName: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

function UnsavedChangesDialog({
  open,
  fileName,
  onCancel,
  onDiscard,
  onSave,
}: UnsavedChangesDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen: boolean) => !isOpen && onCancel()}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <span className="ui-label">Unsaved changes</span>
          <DialogTitle className="type-title-3">
            Unsaved changes
          </DialogTitle>
          <DialogDescription>
            {fileName} has unsaved changes. What would you like to do?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onDiscard}>
            Discard
          </Button>
          <Button onClick={onSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
