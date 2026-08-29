"use client";

import { useState, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/file-utils";

interface FileTreeProps {
  nodes: FileNode[];
  basePath: string;
  onFileClick: (path: string) => void;
  activePath?: string;
  depth?: number;
}

export function FileTree({
  nodes,
  basePath,
  onFileClick,
  activePath,
  depth = 0,
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadedChildren, setLoadedChildren] = useState<Map<string, FileNode[]>>(
    new Map()
  );
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  const fetchChildren = useCallback(
    async (dirPath: string) => {
      if (loadedChildren.has(dirPath)) return;

      setLoadingDirs((prev) => new Set(prev).add(dirPath));
      try {
        const res = await fetch(
          `/api/files?path=${encodeURIComponent(dirPath)}`
        );
        const data = await res.json();
        if (data.files) {
          setLoadedChildren((prev) => new Map(prev).set(dirPath, data.files));
        }
      } catch (err) {
        console.error("Failed to load directory:", err);
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [loadedChildren]
  );

  const toggleExpand = useCallback(
    async (path: string) => {
      const isCurrentlyExpanded = expanded.has(path);

      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });

      if (!isCurrentlyExpanded && !loadedChildren.has(path)) {
        await fetchChildren(path);
      }
    },
    [expanded, loadedChildren, fetchChildren]
  );

  return (
    <div className={cn("w-full", depth > 0 && "border-[var(--fill-2)] ml-3 border-l")}>
      {nodes.map((node) => {
        const isExpanded = expanded.has(node.path);
        const isDirectory = node.type === "directory";
        const isLoading = loadingDirs.has(node.path);
        const children = loadedChildren.get(node.path) || node.children;
        const isActive = activePath === node.path;

        return (
          <div key={node.path}>
            <button
              onClick={() => {
                if (isDirectory) {
                  toggleExpand(node.path);
                } else {
                  onFileClick(node.path);
                }
              }}
              className={cn(
                "group relative flex h-10 w-full items-center gap-1.5 pr-2 pl-2 text-left transition-colors hover:bg-[var(--fill-4)] md:h-7",
                isActive && "bg-[var(--fill-3)]"
              )}
            >
              {isActive && (
                <span className="bg-primary absolute inset-y-0 left-0 w-0.5" />
              )}

              {isDirectory ? (
                <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center">
                  {isLoading ? (
                    <Loader2 className="text-muted-foreground h-3 w-3 animate-spin" />
                  ) : isExpanded ? (
                    <ChevronDown className="text-muted-foreground h-3 w-3" />
                  ) : (
                    <ChevronRight className="text-muted-foreground h-3 w-3" />
                  )}
                </span>
              ) : (
                <span className="h-3 w-3 flex-shrink-0" />
              )}

              <span className="flex-shrink-0">
                {isDirectory ? (
                  isExpanded ? (
                    <FolderOpen className="text-muted-foreground h-3.5 w-3.5" />
                  ) : (
                    <Folder className="text-muted-foreground h-3.5 w-3.5" />
                  )
                ) : (
                  <FileIcon extension={node.extension || ""} />
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
            </button>

            {isDirectory && isExpanded && children && children.length > 0 && (
              <FileTree
                nodes={children}
                basePath={basePath}
                onFileClick={onFileClick}
                activePath={activePath}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FileIcon({ extension }: { extension: string }) {
  return (
    <File className="text-muted-foreground h-3.5 w-3.5 opacity-70" />
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
