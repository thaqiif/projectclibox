"use client";

import { useState, useCallback, useMemo } from "react";
import { useEffect } from "react";
import { useDirectoryFilesQuery } from "@/data/files";
import type { FileNode } from "@/lib/file-utils";
import { relativeToRoot } from "@/lib/file-paths";

interface UseDirectoryBrowserOptions {
  initialPath?: string;
  /** Filter which files to show (e.g., directories only) */
  filter?: (node: FileNode) => boolean;
}

function sortFiles(files: FileNode[]): FileNode[] {
  return [...files].sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return a.name.localeCompare(b.name);
  });
}

export function useDirectoryBrowser(options: UseDirectoryBrowserOptions = {}) {
  const { initialPath = "~", filter } = options;

  const [requestedPath, setRequestedPath] = useState(initialPath);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // The browser UI displays absolute paths, while the Rust endpoint accepts
  // paths relative to the workspace root. Load that root first, then turn
  // every breadcrumb selection into a safe relative request.
  const queryPath = rootPath
    ? relativeToRoot(requestedPath === "~" ? rootPath : requestedPath, rootPath)
    : "";
  const { data, isPending, error } = useDirectoryFilesQuery(queryPath);

  useEffect(() => {
    if (data?.resolvedPath && !rootPath) setRootPath(data.resolvedPath);
  }, [data?.resolvedPath, rootPath]);

  // Resolved path for display/navigation (e.g., "~" → "/Users/saad")
  const currentPath =
    data?.resolvedPath || (requestedPath === "~" ? rootPath || "~" : requestedPath);
  const filesData = data?.files;

  // Filter and sort files from query data
  const files = useMemo(() => {
    if (!filesData) return [];
    const items = filter
      ? filesData.filter(filter)
      : filesData;
    return sortFiles(items);
  }, [filesData, filter]);

  const filteredFiles = useMemo(
    () =>
      search
        ? files.filter((f) =>
            f.name.toLowerCase().includes(search.toLowerCase())
          )
        : files,
    [files, search]
  );

  const navigateTo = useCallback((path: string) => {
    setSearch("");
    setRequestedPath(path);
  }, []);

  const navigateUp = useCallback(() => {
    if (rootPath && currentPath === rootPath) {
      navigateTo("~");
      return;
    }
    const parts = currentPath.split("/").filter(Boolean);
    if (parts.length > 1 && (!rootPath || currentPath.startsWith(`${rootPath}/`))) {
      parts.pop();
      navigateTo("/" + parts.join("/"));
    } else {
      navigateTo("~");
    }
  }, [currentPath, navigateTo, rootPath]);

  const navigateHome = useCallback(() => {
    navigateTo("~");
  }, [navigateTo]);

  const pathSegments = useMemo(
    () => currentPath.split("/").filter(Boolean),
    [currentPath]
  );

  return {
    currentPath,
    files,
    filteredFiles,
    loading: isPending,
    error: error?.message || null,
    search,
    setSearch,
    pathSegments,
    navigateTo,
    navigateUp,
    navigateHome,
  };
}
