"use client";

import { useState, useCallback, useMemo } from "react";
import { useDirectoryFilesQuery } from "@/data/files";
import type { FileNode } from "@/lib/file-utils";

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
  const [search, setSearch] = useState("");

  const { data, isPending, error } = useDirectoryFilesQuery(requestedPath);

  // Resolved path for display/navigation (e.g., "~" → "/Users/saad")
  const currentPath = data?.resolvedPath || requestedPath;
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
    const parts = currentPath.split("/").filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      navigateTo("/" + parts.join("/"));
    } else {
      navigateTo("/");
    }
  }, [currentPath, navigateTo]);

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
