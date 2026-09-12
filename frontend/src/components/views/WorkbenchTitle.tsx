"use client";

import { useEffect, useRef, useState } from "react";

interface WorkbenchTitleProps {
  name: string;
  onRename: (name: string, newName: string) => void | Promise<void>;
}

/**
 * The attached terminal's name, renamable in place.
 *
 * Double-click is the quick path; the sidebar's menu still offers the same
 * thing for anyone looking for it.
 */
export function WorkbenchTitle({ name, onRename }: WorkbenchTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Guards against Enter and the follow-up blur both committing. */
  const committedRef = useRef(false);

  useEffect(() => {
    if (!isEditing) return;
    committedRef.current = false;

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [isEditing, name]);

  const startEditing = () => {
    setDraft(name);
    setIsEditing(true);
  };

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;

    const next = draft.trim();
    if (next && next !== name) void onRename(name, next);
    setIsEditing(false);
  };

  const cancel = () => {
    committedRef.current = true;
    setDraft(name);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className="ring-primary/50 min-w-0 max-w-56 flex-1 rounded-md bg-[var(--fill-3)] px-2 py-0.5 text-[0.8125rem] font-medium outline-none ring-2"
      />
    );
  }

  return (
    <span
      onDoubleClick={startEditing}
      title="Double-click to rename"
      className="cursor-text truncate text-[0.8125rem] font-medium tracking-[-0.006em]"
    >
      {name}
    </span>
  );
}
