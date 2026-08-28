"use client";

import { useState, useEffect } from "react";
import {
  X,
  Folder,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Home,
  Check,
  GitBranch,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AEmptyState } from "@/components/a/AEmptyState";
import { useDirectoryBrowser } from "@/hooks/useDirectoryBrowser";

const DIRS_ONLY = (f: { type: string }) => f.type === "directory";

interface FolderPickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

/**
 * Full-screen folder browser.
 *
 * The chrome — title bar, breadcrumb, footer — is glass; the list of folders
 * is content and stays opaque, so names read cleanly while scrolling. The
 * path is the one thing here that is literally a path, so it is the one
 * thing set in mono.
 */
export function FolderPicker({
  initialPath,
  onSelect,
  onClose,
}: FolderPickerProps) {
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
  } = useDirectoryBrowser({ initialPath, filter: DIRS_ONLY });

  // Git repo check for current directory
  const [isGitRepo, setIsGitRepo] = useState(false);

  useEffect(() => {
    fetch("/api/git/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentPath }),
    })
      .then((res) => res.json())
      .then((data) => setIsGitRepo(data.isGitRepo || false))
      .catch(() => setIsGitRepo(false));
  }, [currentPath]);

  const folderName = pathSegments[pathSegments.length - 1] || "root";

  return (
    <div className="ambient-canvas materialize fixed inset-0 z-[100] flex flex-col">
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
          Choose a folder
        </h2>
        <span className="ui-meta ml-auto min-w-0 truncate">{currentPath}</span>
      </div>

      {/* Search + breadcrumb */}
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            type="text"
            placeholder="Search folders"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 rounded-full pl-9 text-[0.8125rem]"
          />
        </div>

        <div className="scrollbar-none flex items-center gap-1 overflow-x-auto">
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
      </div>

      {/* Content */}
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
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
            title={search ? "No matching folders" : "No subfolders"}
            description={
              search ? "Try a different search." : "This folder is empty."
            }
          />
        ) : (
          <div className="flex flex-col">
            {filteredFiles.map((node) => (
              <button
                key={node.path}
                onClick={() => navigateTo(node.path)}
                className="press focus-ring flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors hover:bg-[var(--fill-4)]"
              >
                <Folder className="text-primary h-4 w-4 shrink-0" />
                <span className="text-foreground min-w-0 flex-1 truncate text-[0.8125rem]">
                  {node.name}
                </span>
                <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer with select button */}
      <div className="glass glass-edge-top relative z-10 flex shrink-0 items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Folder className="text-primary h-4 w-4 shrink-0" />
          <span className="text-foreground truncate text-[0.8125rem] font-medium">
            {folderName}
          </span>
          {isGitRepo && (
            <span className="text-muted-foreground flex shrink-0 items-center gap-1 rounded-full bg-[var(--fill-2)] px-2 py-0.5 text-[0.625rem] font-medium">
              <GitBranch className="h-3 w-3" />
              Git
            </span>
          )}
        </div>
        <Button onClick={() => onSelect(currentPath)} className="shrink-0 gap-2">
          <Check className="h-4 w-4" />
          Choose
        </Button>
      </div>
    </div>
  );
}
