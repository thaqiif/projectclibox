"use client";

import { useRef, useEffect } from "react";
import { X, File } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpenFile } from "@/hooks/useFileEditor";

interface FileTabsProps {
  files: OpenFile[];
  activeFilePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  isDirty: (path: string) => boolean;
}

export function FileTabs({
  files,
  activeFilePath,
  onSelect,
  onClose,
  isDirty,
}: FileTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    if (activeTabRef.current && scrollRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [activeFilePath]);

  if (files.length === 0) {
    return null;
  }

  return (
    <div
      ref={scrollRef}
      className="scrollbar-none glass glass-edge-bottom relative z-10 flex h-9 items-stretch overflow-x-auto"
    >
      {files.map((file, index) => {
        const isActive = file.path === activeFilePath;
        const dirty = isDirty(file.path);
        const fileName = file.path.split("/").pop() || file.path;
        const ext = fileName.split(".").pop()?.toLowerCase() || "";

        return (
          <div
            key={file.path}
            ref={isActive ? activeTabRef : null}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(file.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(file.path);
              }
            }}
            className={cn(
              "group relative flex cursor-pointer items-center gap-2 whitespace-nowrap border-r border-[var(--fill-2)] px-2.5 text-xs transition-colors",
              isActive
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-[var(--fill-4)] hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "text-[0.625rem] tracking-[0.02em]",
                isActive ? "text-primary" : "text-muted-foreground/70"
              )}
            >
              {index + 1}
            </span>
            <FileIcon extension={ext} />
            <span className="max-w-[140px] truncate font-mono">{fileName}</span>
            {dirty && (
              <span className="bg-status-waiting h-1.5 w-1.5 flex-shrink-0" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(file.path);
              }}
              aria-label={`Close ${fileName}`}
              className={cn(
                "-mr-1 flex-shrink-0 p-0.5 transition-opacity",
                "hover:text-foreground",
                isActive
                  ? "opacity-60 hover:opacity-100"
                  : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
              )}
            >
              <X className="h-3 w-3" />
            </button>
            {isActive && (
              <span className="bg-primary absolute inset-x-0 bottom-0 h-px" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FileIcon({ extension }: { extension: string }) {
  return (
    <File className="text-muted-foreground h-3 w-3 flex-shrink-0 opacity-70" />
  );
}
