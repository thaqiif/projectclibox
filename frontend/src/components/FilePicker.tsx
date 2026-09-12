"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  Folder,
  FileIcon,
  FileImage,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Home,
  Upload,
  Clipboard,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFileToTemp } from "@/lib/file-upload";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useViewport } from "@/hooks/useViewport";
import { useDirectoryBrowser } from "@/hooks/useDirectoryBrowser";
import { AEmptyState } from "@/components/a/AEmptyState";
import type { FileNode } from "@/lib/file-utils";

const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
];

interface FilePickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

function isImageFile(node: FileNode) {
  if (node.type !== "file") return false;
  const ext = node.extension?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.includes(ext);
}

export function FilePicker({
  initialPath,
  onSelect,
  onClose,
}: FilePickerProps) {
  const {
    currentPath,
    filteredFiles,
    loading,
    error,
    search,
    setSearch,
    pathSegments,
    navigateTo,
    navigateUp,
    navigateHome,
  } = useDirectoryBrowser({ initialPath });

  const [uploading, setUploading] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = useViewport();

  // Handle dropped/pasted/selected file
  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const path = await uploadFileToTemp(file);
        if (path) {
          onSelect(path);
        }
      } catch (err) {
        console.error("Failed to upload file:", err);
      } finally {
        setUploading(false);
      }
    },
    [onSelect]
  );

  // Drag and drop (desktop only)
  const { isDragging, dragHandlers } = useFileDrop(dropZoneRef, handleFile, {
    disabled: uploading || isMobile,
  });

  // Clipboard paste handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFile(file);
            break;
          }
        }
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleFile]);

  const handleItemClick = (node: FileNode) => {
    if (node.type === "directory") {
      navigateTo(node.path);
    } else if (node.type === "file") {
      onSelect(node.path);
    }
  };

  return (
    <div className="ambient-canvas materialize fixed inset-0 z-50 flex flex-col">
      {/* Title bar */}
      <div className="glass glass-edge-bottom relative z-10 flex h-13 shrink-0 items-center gap-2 px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close picker"
          className="rounded-full"
        >
          <X className="h-4 w-4" />
        </Button>
        <h2 className="text-[0.9375rem] font-semibold tracking-[-0.014em]">
          Choose a file
        </h2>
        <span className="ui-meta ml-auto min-w-0 truncate">{currentPath}</span>
      </div>

      {/* Breadcrumb */}
      <div className="scrollbar-none flex shrink-0 items-center gap-1 px-3 pt-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={navigateHome}
          aria-label="Home"
          className="shrink-0 rounded-full"
        >
          <Home className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={navigateUp}
          aria-label="Go up"
          className="shrink-0 rounded-full"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="ui-meta flex min-w-0 items-center gap-0.5">
          <span className="text-muted-foreground/60">/</span>
          {pathSegments.map((segment, i) => (
            <button
              key={i}
              onClick={() =>
                navigateTo("/" + pathSegments.slice(0, i + 1).join("/"))
              }
              className="hover:text-foreground focus-ring flex shrink-0 items-center rounded transition-colors"
            >
              <span className="max-w-[100px] truncate">{segment}</span>
              {i < pathSegments.length - 1 && (
                <ChevronRight className="mx-0.5 h-3 w-3 opacity-50" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Upload zone */}
      {isMobile ? (
        <div className="flex items-center justify-center gap-2 px-3 py-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-2"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
          <span className="text-muted-foreground text-[0.75rem]">
            or pick one below
          </span>
        </div>
      ) : (
        <div
          ref={dropZoneRef}
          {...dragHandlers}
          className={cn(
            "mx-3 mt-2.5 flex flex-col items-center justify-center gap-1 rounded-xl p-4",
            "border border-dashed border-[var(--fill-1)] bg-[var(--fill-4)]",
            "transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
            isDragging && "border-primary/70 bg-primary/10",
            uploading && "opacity-50"
          )}
        >
          {uploading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
              <span className="text-muted-foreground text-[0.8125rem]">
                Uploading…
              </span>
            </div>
          ) : isDragging ? (
            <span className="text-primary text-[0.8125rem] font-medium">
              Drop to upload
            </span>
          ) : (
            <>
              <div className="text-muted-foreground flex items-center gap-2 text-[0.8125rem]">
                <Upload className="h-4 w-4" />
                <span>Drop a file here</span>
              </div>
              <div className="text-muted-foreground/70 flex items-center gap-1.5 text-[0.75rem]">
                <Clipboard className="h-3 w-3" />
                <span>or paste from the clipboard</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            type="text"
            placeholder="Search files"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 rounded-full pl-9 text-[0.8125rem]"
          />
        </div>
      </div>

      {/* Content */}
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-32 items-center justify-center gap-2">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            <span className="text-muted-foreground text-[0.8125rem]">
              Loading…
            </span>
          </div>
        ) : error ? (
          <AEmptyState
            size="compact"
            tone="error"
            title="Couldn't open that folder"
            description={error}
            action={{ label: "Go back", onClick: navigateUp }}
          />
        ) : filteredFiles.length === 0 ? (
          <AEmptyState
            size="compact"
            icon={Folder}
            title={search ? "No matching files" : "Empty folder"}
            description={
              search ? "Try a different search." : "There is nothing in here."
            }
          />
        ) : (
          <div className="flex flex-col px-2">
            {filteredFiles.map((node) => {
              const isImg = isImageFile(node);
              const isDir = node.type === "directory";

              return (
                <button
                  key={node.path}
                  onClick={() => handleItemClick(node)}
                  className={cn(
                    "press focus-ring flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors hover:bg-[var(--fill-4)]"
                  )}
                >
                  {isDir ? (
                    <Folder className="text-primary h-4 w-4 shrink-0" />
                  ) : isImg ? (
                    <FileImage className="text-muted-foreground h-4 w-4 shrink-0" />
                  ) : node.extension ? (
                    <FileIcon className="text-muted-foreground h-4 w-4 shrink-0" />
                  ) : (
                    <span className="text-muted-foreground w-3.5 shrink-0 text-center text-[0.625rem]">
                      ?
                    </span>
                  )}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[0.8125rem]",
                      isDir ? "text-foreground font-medium" : "text-foreground"
                    )}
                  >
                    {node.name}
                  </span>
                  {!isDir && node.extension && (
                    <span className="text-muted-foreground shrink-0 rounded-full bg-[var(--fill-2)] px-1.5 text-[0.625rem] leading-4">
                      {node.extension}
                    </span>
                  )}
                  {isDir && (
                    <ChevronRight className="text-muted-foreground h-3 w-3 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="glass glass-edge-top relative z-10 shrink-0 px-3 py-2.5 text-center">
        <p className="text-muted-foreground text-[0.75rem]">
          Pick a file, or open a folder to keep looking.
        </p>
      </div>
    </div>
  );
}
