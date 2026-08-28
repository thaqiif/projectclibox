"use client";

import { useState } from "react";
import { Loader2, FileCode, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommitItem } from "./CommitItem";
import { DiffView } from "@/components/DiffViewer/DiffModal";
import { useCommitHistory, useCommitFileDiff } from "@/data/git/queries";
import { useViewport } from "@/hooks/useViewport";
import type { CommitFile } from "@/lib/git-history";

interface CommitHistoryProps {
  workingDirectory: string;
}

interface SelectedFileDiff {
  hash: string;
  file: CommitFile;
}

export function CommitHistory({ workingDirectory }: CommitHistoryProps) {
  const { isMobile } = useViewport();
  const {
    data: commits,
    isLoading,
    error,
  } = useCommitHistory(workingDirectory);
  const [selectedFile, setSelectedFile] = useState<SelectedFileDiff | null>(
    null
  );

  // Fetch diff when file is selected
  const { data: diff, isLoading: loadingDiff } = useCommitFileDiff(
    workingDirectory,
    selectedFile?.hash ?? null,
    selectedFile?.file.path ?? null
  );

  const handleFileClick = (hash: string, file: CommitFile) => {
    setSelectedFile({ hash, file });
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4">
        <p className="ui-label">Couldn&apos;t load history</p>
        <p className="ui-meta">failed to load commit history</p>
      </div>
    );
  }

  if (!commits?.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4">
        <p className="ui-label">No commits yet</p>
        <p className="ui-meta">
          committed revisions will be listed here
        </p>
      </div>
    );
  }

  // Mobile: full-screen diff view when file selected
  if (isMobile && selectedFile) {
    return (
      <div className="flex h-full flex-col">
        <div className="glass glass-edge-bottom relative z-10 flex items-center gap-2 px-2 py-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSelectedFile(null)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="ui-meta truncate">{selectedFile.file.path}</p>
            <p className="text-muted-foreground/70 text-[0.6875rem]">
              {selectedFile.hash.slice(0, 7)}
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {loadingDiff ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : (
            <DiffView diff={diff || ""} fileName={selectedFile.file.path} />
          )}
        </div>
      </div>
    );
  }

  // Mobile: commit list only
  if (isMobile) {
    return (
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {commits.map((commit) => (
          <CommitItem
            key={commit.hash}
            commit={commit}
            workingDir={workingDirectory}
            onFileClick={handleFileClick}
            selectedFile={
              selectedFile
                ? { hash: selectedFile.hash, path: selectedFile.file.path }
                : null
            }
          />
        ))}
      </div>
    );
  }

  // Desktop: side-by-side layout
  return (
    <div className="flex min-h-0 flex-1">
      {/* Commit list */}
      <div className="scrollbar-thin border-[var(--fill-2)] w-[300px] flex-shrink-0 overflow-y-auto border-r">
        {commits.map((commit) => (
          <CommitItem
            key={commit.hash}
            commit={commit}
            workingDir={workingDirectory}
            onFileClick={handleFileClick}
            selectedFile={
              selectedFile
                ? { hash: selectedFile.hash, path: selectedFile.file.path }
                : null
            }
          />
        ))}
      </div>

      {/* Diff view */}
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {loadingDiff ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : selectedFile && diff !== undefined ? (
          <>
            <div className="glass glass-edge-bottom relative z-10 flex items-center gap-2 px-3 py-2">
              <FileCode className="text-muted-foreground h-3.5 w-3.5" />
              <span className="ui-meta min-w-0 flex-1 truncate">
                {selectedFile.file.path}
              </span>
              <span className="text-muted-foreground/70 shrink-0 text-[0.6875rem]">
                {selectedFile.hash.slice(0, 7)}
              </span>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <DiffView diff={diff} fileName={selectedFile.file.path} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <p className="ui-label">Nothing selected</p>
            <p className="ui-meta">select a commit file to view diff</p>
          </div>
        )}
      </div>
    </div>
  );
}
