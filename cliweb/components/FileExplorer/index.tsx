"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FileTree } from "./FileTree";
import { FileEditor } from "./FileEditor";
import { FileTabs } from "./FileTabs";
import type { UseFileEditorReturn } from "@/hooks/useFileEditor";
import { useViewport } from "@/hooks/useViewport";
import { Loader2, ArrowLeft, Save } from "lucide-react";
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
import type { OpenFile } from "@/hooks/useFileEditor";

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

  const {
    openFiles,
    activeFilePath,
    loading: fileLoading,
    saving,
    openFile,
    closeFile,
    setActiveFile,
    updateContent,
    saveFile,
    isDirty,
    getFile,
  } = fileEditor;

  // Load directory contents
  useEffect(() => {
    const loadFiles = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/files?path=${encodeURIComponent(workingDirectory)}`
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
    await saveFile(pendingClose);
    closeFile(pendingClose);
    setPendingClose(null);
  }, [pendingClose, saveFile, closeFile]);

  const handleSave = useCallback(async () => {
    if (activeFilePath) {
      await saveFile(activeFilePath);
    }
  }, [activeFilePath, saveFile]);

  const activeFile = activeFilePath ? getFile(activeFilePath) : undefined;

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
        files={files}
        loading={loading}
        error={error}
        fileLoading={fileLoading}
        workingDirectory={workingDirectory}
        openFiles={openFiles}
        activeFilePath={activeFilePath}
        activeFile={activeFile}
        saving={saving}
        onFileClick={handleFileClick}
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
      />
    );
  }

  // Desktop layout: side-by-side tree + editor
  return (
    <DesktopFileExplorer
      files={files}
      loading={loading}
      error={error}
      fileLoading={fileLoading}
      workingDirectory={workingDirectory}
      openFiles={openFiles}
      activeFilePath={activeFilePath}
      activeFile={activeFile}
      saving={saving}
      onFileClick={handleFileClick}
      onSelectTab={setActiveFile}
      onCloseTab={handleCloseFile}
      onSave={handleSave}
      isDirty={isDirty}
      updateContent={updateContent}
      pendingClose={pendingClose}
      onCancelClose={() => setPendingClose(null)}
      onConfirmClose={handleConfirmClose}
      onSaveAndClose={handleSaveAndClose}
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
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSave: () => void;
  isDirty: (path: string) => boolean;
  updateContent: (path: string, content: string) => void;
  pendingClose: string | null;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  onSaveAndClose: () => void;
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
  onSelectTab,
  onCloseTab,
  onSave,
  isDirty,
  updateContent,
  pendingClose,
  onCancelClose,
  onConfirmClose,
  onSaveAndClose,
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
        <div className="glass glass-edge-bottom relative z-10 flex h-9 shrink-0 items-center gap-2 px-2.5">
          <span className="ui-label">Files</span>
          <span className="ui-meta truncate">{workingDirectory}</span>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-32 items-center justify-center gap-2">
              <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
              <span className="ui-label">Loading</span>
            </div>
          ) : error ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 p-4">
              <span className="text-destructive ui-label">
                Couldn&apos;t load
              </span>
              <p className="ui-meta text-center">{error}</p>
            </div>
          ) : files.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <p className="ui-label">Nothing here</p>
              <p className="ui-meta">directory has no entries</p>
            </div>
          ) : (
            <div className="py-1">
              <FileTree
                nodes={files}
                basePath={workingDirectory}
                onFileClick={onFileClick}
                activePath={activeFilePath ?? undefined}
              />
            </div>
          )}
        </div>
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

        {/* Editor or empty state */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {fileLoading ? (
            <div className="flex h-full items-center justify-center gap-2">
              <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
              <span className="ui-label">Loading</span>
            </div>
          ) : activeFile ? (
            <FileEditor
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
    </div>
  );
}

// Mobile: Full-screen tree OR full-screen editor
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

        {/* Editor */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {fileLoading ? (
            <div className="flex h-full items-center justify-center gap-2">
              <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
              <span className="ui-label">Loading</span>
            </div>
          ) : (
            <FileEditor
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
      </div>
    );
  }

  // Show file tree
  return (
    <div className="bg-background flex h-full w-full flex-col">
      <div className="glass glass-edge-bottom relative z-10 flex h-12 shrink-0 flex-col justify-center gap-0.5 px-3">
        <span className="ui-label">Files</span>
        <span className="ui-meta truncate">{workingDirectory}</span>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-32 items-center justify-center gap-2">
            <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
            <span className="ui-label">Loading</span>
          </div>
        ) : error ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 p-4">
            <span className="text-destructive ui-label">
              Couldn&apos;t load
            </span>
            <p className="ui-meta text-center">{error}</p>
          </div>
        ) : files.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2">
            <p className="ui-label">Nothing here</p>
            <p className="ui-meta">directory has no entries</p>
          </div>
        ) : (
          <div className="py-1">
            <FileTree
              nodes={files}
              basePath={workingDirectory}
              onFileClick={onFileClick}
              activePath={activeFilePath ?? undefined}
            />
          </div>
        )}
      </div>

      {fileLoading && (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <Loader2 className="text-primary h-6 w-6 animate-spin" />
        </div>
      )}
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
