"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Home,
  ChevronUp,
  Loader2,
  FolderInput,
  HardDrive,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AEmptyState } from "@/components/a/AEmptyState";
import type { FileNode } from "@/lib/file-utils";

interface DirectoryPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function DirectoryPicker({
  open,
  onClose,
  onSelect,
  initialPath = "~",
}: DirectoryPickerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track home directory path from API
  const [homePath, setHomePath] = useState<string | null>(null);

  // Fetch directory contents
  const fetchDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return { dirs: [], expandedPath: path };
      }
      // Store the home path if we're at ~
      if (path === "~" && data.path) {
        setHomePath(data.path);
      }
      // Filter to only directories
      const dirs = (data.files || []).filter(
        (f: FileNode) => f.type === "directory"
      );
      return { dirs, expandedPath: data.path };
    } catch {
      setError("Failed to load directory");
      return { dirs: [], expandedPath: path };
    } finally {
      setLoading(false);
    }
  }, []);

  // Load initial directory
  useEffect(() => {
    if (open) {
      fetchDirectory(currentPath).then(({ dirs }) => setDirectories(dirs));
      setSelectedPath(null);
    }
  }, [open, currentPath, fetchDirectory]);

  // Navigate up to parent
  const goUp = () => {
    // Can't go above root
    if (currentPath === "/") {
      return;
    }

    // From ~ or homePath, go to parent of home directory
    if (currentPath === "~" || (homePath && currentPath === homePath)) {
      if (homePath) {
        const homeParent = homePath.split("/").slice(0, -1).join("/") || "/";
        setCurrentPath(homeParent);
        setExpanded(new Set());
      }
      return;
    }

    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const newPath = currentPath.startsWith("~")
      ? "~/" + parts.slice(1).join("/") || "~"
      : "/" + parts.join("/") || "/";
    setCurrentPath(newPath);
    setExpanded(new Set());
  };

  // Go to root
  const goRoot = () => {
    setCurrentPath("/");
    setExpanded(new Set());
  };

  // Go to home
  const goHome = () => {
    setCurrentPath("~");
    setExpanded(new Set());
  };

  // Toggle directory expansion and fetch children
  const toggleExpand = async (node: FileNode) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(node.path)) {
      newExpanded.delete(node.path);
    } else {
      newExpanded.add(node.path);
      // Fetch children if not already loaded
      if (!node.children || node.children.length === 0) {
        const { dirs } = await fetchDirectory(node.path);
        // Update the node with children
        setDirectories((prev) => updateNodeChildren(prev, node.path, dirs));
      }
    }
    setExpanded(newExpanded);
  };

  // Select a directory
  const handleSelect = (path: string) => {
    setSelectedPath(path);
  };

  // Confirm selection
  const handleConfirm = () => {
    if (selectedPath) {
      // Convert absolute path back to ~ format if it's in home directory
      let finalPath = selectedPath;
      if (homePath && selectedPath.startsWith(homePath)) {
        finalPath = "~" + selectedPath.slice(homePath.length);
      }
      onSelect(finalPath);
      onClose();
    }
  };

  // Select current directory
  const selectCurrentDirectory = () => {
    // Convert to ~ format if in home directory
    let finalPath = currentPath;
    if (homePath && currentPath.startsWith(homePath)) {
      finalPath = "~" + currentPath.slice(homePath.length);
    }
    onSelect(finalPath);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>Choose a directory</DialogTitle>
        </DialogHeader>

        {/* Navigation bar */}
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--fill-4)] py-1 pr-1 pl-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={goRoot}
            aria-label="Root"
            className="rounded-full"
          >
            <HardDrive className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={goHome}
            aria-label="Home"
            className="rounded-full"
          >
            <Home className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={goUp}
            disabled={currentPath === "/"}
            aria-label="Go up"
            className="rounded-full"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <span className="ui-meta min-w-0 flex-1 truncate px-1">
            {currentPath}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={selectCurrentDirectory}
            className="shrink-0 gap-1.5 rounded-full"
          >
            <FolderInput className="h-3.5 w-3.5" />
            Use this
          </Button>
        </div>

        {/* Directory listing */}
        <div className="scrollbar-thin max-h-[400px] min-h-[200px] flex-1 overflow-y-auto">
          {loading && directories.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
              <span className="text-muted-foreground text-[0.8125rem]">
                Loading…
              </span>
            </div>
          ) : error ? (
            <AEmptyState
              size="compact"
              tone="error"
              title="Couldn't read that directory"
              description={error}
            />
          ) : directories.length === 0 ? (
            <AEmptyState
              size="compact"
              icon={Folder}
              title="No subdirectories"
              description="This directory has nothing inside it."
            />
          ) : (
            <div className="py-1">
              <DirectoryTree
                nodes={directories}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggle={toggleExpand}
                onSelect={handleSelect}
                onDoubleClick={(path) => {
                  setCurrentPath(path);
                  setExpanded(new Set());
                }}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedPath}>
            Select
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DirectoryTreeProps {
  nodes: FileNode[];
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (node: FileNode) => void;
  onSelect: (path: string) => void;
  onDoubleClick: (path: string) => void;
  depth?: number;
}

function DirectoryTree({
  nodes,
  expanded,
  selectedPath,
  onToggle,
  onSelect,
  onDoubleClick,
  depth = 0,
}: DirectoryTreeProps) {
  return (
    <div
      className={cn("w-full", depth > 0 && "ml-3 border-l border-[var(--fill-3)]")}
    >
      {nodes.map((node) => {
        const isExpanded = expanded.has(node.path);
        const isSelected = selectedPath === node.path;

        return (
          <div key={node.path}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(node.path)}
              onDoubleClick={() => onDoubleClick(node.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(node.path);
                }
              }}
              className={cn(
                "press-sm relative flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-lg pr-2 pl-2 text-left",
                "transition-colors duration-200",
                isSelected
                  ? "bg-primary/14 text-foreground"
                  : "hover:bg-[var(--fill-4)]"
              )}
            >
              {/* Expand/collapse */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(node);
                }}
                aria-label={isExpanded ? "Collapse" : "Expand"}
                className={cn(
                  "text-muted-foreground hover:text-foreground flex h-4 w-4 flex-shrink-0 items-center justify-center",
                  "transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                  isExpanded && "rotate-90"
                )}
              >
                <ChevronRight className="h-3 w-3" />
              </button>

              {/* Icon */}
              {isExpanded ? (
                <FolderOpen className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0" />
              ) : (
                <Folder className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0" />
              )}

              {/* Name */}
              <span className="text-foreground flex-1 truncate text-[0.8125rem]">
                {node.name}
              </span>
            </div>

            {/* Children */}
            {isExpanded && node.children && node.children.length > 0 && (
              <DirectoryTree
                nodes={node.children}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
                onDoubleClick={onDoubleClick}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Helper to update node children in tree
function updateNodeChildren(
  nodes: FileNode[],
  targetPath: string,
  children: FileNode[]
): FileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, children };
    }
    if (node.children) {
      return {
        ...node,
        children: updateNodeChildren(node.children, targetPath, children),
      };
    }
    return node;
  });
}
