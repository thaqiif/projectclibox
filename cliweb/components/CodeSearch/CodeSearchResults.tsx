"use client";

import { useCodeSearch } from "@/data/code-search";
import { Loader2, FileCode, Search } from "lucide-react";
import { useState, useEffect } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import type { FormattedMatch } from "@/lib/code-search";

interface CodeSearchResultsProps {
  workingDirectory: string;
  query: string;
  onSelectFile: (file: string, line: number) => void;
}

export function CodeSearchResults({
  workingDirectory,
  query,
  onSelectFile,
}: CodeSearchResultsProps) {
  const { data, isLoading, isError, error } = useCodeSearch(
    workingDirectory,
    query,
    query.length > 2
  );

  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!data?.results.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, data.results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const result = data.results[selectedIndex];
        if (result) {
          onSelectFile(result.file, result.line);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [data, selectedIndex, onSelectFile]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8">
        <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
        <span className="ui-label">Searching</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-destructive px-4 py-6 font-mono text-xs">
        {error instanceof Error ? error.message : "Failed to search code"}
      </div>
    );
  }

  if (query.length < 3) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8">
        <Search className="text-muted-foreground/70 h-4 w-4" />
        <p className="ui-meta">Type at least 3 characters to search</p>
      </div>
    );
  }

  if (!data?.results.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8">
        <FileCode className="text-muted-foreground/70 h-4 w-4" />
        <p className="ui-meta">No matches found for &quot;{query}&quot;</p>
      </div>
    );
  }

  return (
    <div className="divide-[var(--fill-3)] flex flex-col divide-y">
      {data.results.map((result, index) => (
        <SearchResultItem
          key={`${result.file}:${result.line}`}
          result={result}
          isSelected={index === selectedIndex}
          onClick={() => onSelectFile(result.file, result.line)}
        />
      ))}
    </div>
  );
}

interface SearchResultItemProps {
  result: FormattedMatch;
  isSelected: boolean;
  onClick: () => void;
}

function SearchResultItem({
  result,
  isSelected,
  onClick,
}: SearchResultItemProps) {
  const language = getLanguageFromPath(result.file);
  const fileName = result.file.split("/").pop() || result.file;
  const filePath = result.file.includes("/")
    ? result.file.slice(0, result.file.lastIndexOf("/"))
    : "";

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex min-h-[44px] flex-col justify-center gap-1.5 px-4 py-2.5 text-left transition-colors",
        isSelected ? "bg-[var(--fill-3)]" : "hover:bg-[var(--fill-4)]"
      )}
    >
      {isSelected && (
        <span className="bg-primary absolute inset-y-0 left-0 w-0.5" />
      )}

      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-mono text-xs text-foreground">
          {fileName}
        </span>
        {filePath && (
          <span className="truncate text-[0.6875rem] text-muted-foreground">
            {filePath}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[0.625rem] text-muted-foreground/70">
          :{result.line}
        </span>
      </div>

      <div className="border-[var(--fill-2)] overflow-hidden border-l pl-2">
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          customStyle={{
            background: "transparent",
            padding: 0,
            margin: 0,
            fontSize: "11px",
            lineHeight: 1.5,
          }}
          wrapLines
          showLineNumbers={false}
        >
          {result.lineText}
        </SyntaxHighlighter>
      </div>
    </button>
  );
}

function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
  };
  return map[ext] || "text";
}
