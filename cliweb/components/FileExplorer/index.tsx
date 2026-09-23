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
  X,
} from "lucide-react";
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
import { clearSelection, toggleSelection } from "@/lib/file-bulk";
import { fileRename, fileDelete } from "@/lib/file-ops";
import { ListFilter } from "./ListFilter";
import { UploadProgressBanner } from "./UploadProgressBanner";
import { SaveConflictDialog } from "./SaveConflictDialog";

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
}

export function FileExplorer({
  workingDirectory,
  fileEditor,
}: FileExplorerProps) {
  const { isMobile, isHydrated } = useViewport();
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  // Drill-down navigation: current directory being browsed (null = workingDirectory)
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  // Show dotfiles; persisted in localStorage
  const [showHidden, setShowHidden] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
      await saveFile(conflictFilePath, { force: true });
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
  if (!isHydrated) {
    return (
      <div className="bg-background flex h-full w-full items-center justify-center">
        <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
      </div>
    );
  }

  // Mobile layout: full-screen tree OR full-screen editor
  if (isMobile) {
    return (
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
        filter={filter}
        onFilterChange={setFilter}
      />
    );
  }

  // Desktop layout: side-by-side tree + editor
  return (
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
      filter={filter}
      onFilterChange={setFilter}
    />
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
      <div
        className="flex h-full min-w-0 shrink-0 flex-col"
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
    <div className="bg-background flex h-full w-full flex-col">
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
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <Loader2 className="text-primary h-6 w-6 animate-spin" />
        </div>
      )}
      {/* UPLOAD_PROGRESS_INTEGRATION: aggregate upload progress */}
      <UploadProgressBanner className="absolute bottom-2 left-2 right-2 z-20" />
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
}: ListingBodyProps) {
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  // Minimal multi-select wiring: checkbox per row, selection owned here and
  // consumed by the floating BulkActionBar. Coordinator may lift this later.
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Selection refers to paths in the listing; start fresh when navigating.
  useEffect(() => {
    setSelectedPaths(clearSelection());
  }, [workingDirectory]);

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
        <p className="ui-meta">directory has no entries</p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
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
            if (!isDirectory) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOverPath(node.path);
          }}
          onDragLeave={(e) => {
            if (!isDirectory) return;
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOverPath((prev) => (prev === node.path ? null : prev));
          }}
          onDrop={async (e) => {
            if (!isDirectory) return;
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
        onRefresh={onRefresh}
        onClear={() => setSelectedPaths(clearSelection())}
      />
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
