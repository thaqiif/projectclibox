import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import type { FileNode } from "../../lib/file-utils";
import { fileKeys } from "./keys";

export interface DirectoryData {
  files: FileNode[];
  resolvedPath: string;
  nextCursor: string | null;
}

async function fetchDirectory(
  path: string,
  projectId?: string
): Promise<DirectoryData> {
  const data = await api.files(projectId, path);
  return {
    files: data.files,
    resolvedPath: data.path || path,
    nextCursor: data.next_cursor,
  };
}

export function useDirectoryFilesQuery(path: string, projectId?: string) {
  return useQuery({
    queryKey: fileKeys.list(projectId, path),
    queryFn: () => fetchDirectory(path, projectId),
    staleTime: 10000,
  });
}
