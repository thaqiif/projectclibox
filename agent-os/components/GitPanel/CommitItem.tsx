"use client";

import { useState } from "react";
import {
  ChevronRight,
  FileText,
  FilePlus,
  FileX,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommitDetail } from "@/data/git/queries";
import type { CommitSummary, CommitFile } from "@/lib/git-history";

interface CommitItemProps {
  commit: CommitSummary;
  workingDir: string;
  onFileClick: (hash: string, file: CommitFile) => void;
  selectedFile?: { hash: string; path: string } | null;
}

export function CommitItem({
  commit,
  workingDir,
  onFileClick,
  selectedFile,
}: CommitItemProps) {
  const [expanded, setExpanded] = useState(false);

  // Only fetch detail when expanded
  const { data: detail, isLoading } = useCommitDetail(
    workingDir,
    expanded ? commit.hash : null
  );

  const authorInitial = commit.author.charAt(0).toUpperCase();

  return (
    <div className="border-b border-[var(--fill-3)] last:border-b-0">
      {/* Commit summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "hover:bg-[var(--fill-4)] flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors",
          expanded && "bg-surface"
        )}
      >
        <ChevronRight
          className={cn(
            "text-muted-foreground mt-0.5 h-3.5 w-3.5 flex-shrink-0 transition-transform",
            expanded && "rotate-90"
          )}
        />

        {/* Author cell */}
        <div className="bg-surface-raised text-muted-foreground mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center border border-[var(--fill-2)] text-[0.6875rem]">
          {authorInitial}
        </div>

        {/* Commit info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground shrink-0 font-mono text-[0.6875rem]">
              {commit.shortHash}
            </span>
            <span className="truncate text-sm font-medium text-foreground">
              {commit.subject}
            </span>
          </div>
          <div className="ui-meta mt-0.5 flex items-center gap-1.5">
            <span>{commit.author}</span>
            <span>·</span>
            <span>{commit.relativeTime}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-0.5 flex flex-shrink-0 items-center gap-1.5 font-mono text-[0.6875rem] tabular-nums">
          {commit.additions > 0 && (
            <span className="text-status-running">+{commit.additions}</span>
          )}
          {commit.deletions > 0 && (
            <span className="text-status-error">-{commit.deletions}</span>
          )}
        </div>
      </button>

      {/* Expanded file list */}
      {expanded && (
        <div className="border-[var(--fill-2)] mb-2 ml-6 border-l pl-2 pr-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            </div>
          ) : detail?.files?.length ? (
            <div className="divide-y divide-[var(--fill-3)]">
              {detail.files.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  isSelected={
                    selectedFile?.hash === commit.hash &&
                    selectedFile?.path === file.path
                  }
                  onClick={() => onFileClick(commit.hash, file)}
                />
              ))}
            </div>
          ) : (
            <p className="ui-meta py-2">no files changed</p>
          )}
        </div>
      )}
    </div>
  );
}

interface FileRowProps {
  file: CommitFile;
  isSelected: boolean;
  onClick: () => void;
}

function FileRow({ file, isSelected, onClick }: FileRowProps) {
  const statusColor = getStatusColor(file.status);

  return (
    <button
      onClick={onClick}
      className={cn(
        "hover:bg-[var(--fill-4)] relative flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
        isSelected && "bg-[var(--fill-3)]"
      )}
    >
      {isSelected && (
        <span className="bg-primary absolute inset-y-0 left-0 w-0.5" />
      )}
      {renderStatusIcon(
        file.status,
        cn("h-3.5 w-3.5 flex-shrink-0", statusColor)
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem]">
        {file.oldPath ? (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">{file.oldPath}</span>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <span className="text-foreground">{file.path}</span>
          </span>
        ) : (
          <span className="text-foreground">{file.path}</span>
        )}
      </span>
      <div className="flex flex-shrink-0 items-center gap-1.5 text-[0.6875rem] tabular-nums">
        {file.additions > 0 && (
          <span className="text-status-running">+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span className="text-status-error">-{file.deletions}</span>
        )}
      </div>
    </button>
  );
}

function renderStatusIcon(status: CommitFile["status"], className: string) {
  switch (status) {
    case "added":
      return <FilePlus className={className} />;
    case "deleted":
      return <FileX className={className} />;
    case "renamed":
      return <ArrowRight className={className} />;
    default:
      return <FileText className={className} />;
  }
}

function getStatusColor(status: CommitFile["status"]) {
  switch (status) {
    case "added":
      return "text-status-running";
    case "deleted":
      return "text-status-error";
    case "renamed":
      return "text-status-info";
    default:
      return "text-status-waiting";
  }
}
