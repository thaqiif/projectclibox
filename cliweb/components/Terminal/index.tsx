"use client";

import {
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useEffect,
  useState,
  useMemo,
} from "react";
import { useTheme } from "next-themes";
import "@xterm/xterm/css/xterm.css";
import { WifiOff, Upload, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { TerminalToolbar } from "./TerminalToolbar";
import { useTerminalConnection } from "./hooks";
import type { TerminalScrollState } from "./hooks";
import { useViewport } from "@/hooks/useViewport";
import { useFileDrop } from "@/hooks/useFileDrop";
import {
  PASTE_AS_FILE_THRESHOLD,
  pasteLongAsFilePref,
  uploadFileToTemp,
  uploadTargetDir,
  uploadTextAsPasteFile,
} from "@/lib/file-upload";
import { useFontScale } from "@/contexts/FontScaleContext";

/**
 * Mobile long-paste dialog. Clipboard text is captured from the paste event
 * and prefilled here; the user edits it, then chooses inline paste (typed
 * into the terminal) or upload-as-file (txt into tmp, path inserted).
 */
function LongPasteDialog({
  initialText,
  onClose,
  onPasteAsFile,
  onPasteInline,
}: {
  initialText: string;
  onClose: () => void;
  onPasteAsFile: (text: string) => void;
  onPasteInline: (text: string) => void;
}) {
  const [text, setText] = useState(initialText);
  // Checkbox default follows the stored user preference (default true).
  const [sendAsFile, setSendAsFile] = useState(() => pasteLongAsFilePref());

  const confirm = () => {
    if (sendAsFile) onPasteAsFile(text);
    else onPasteInline(text);
  };

  return (
    <div
      className="animate-in fade-in-0 fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[3px] duration-200"
      onClick={onClose}
    >
      <div
        className="glass-thick glass-float lift-in w-[90%] max-w-md rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.014em]">
            Paste options
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="press focus-ring text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--fill-3)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="placeholder:text-muted-foreground/70 focus-visible:border-ring/70 focus-visible:ring-ring/25 h-40 w-full resize-none rounded-lg border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 font-mono text-[0.75rem] outline-none focus-visible:ring-[3px]"
        />
        <label className="text-muted-foreground mt-3 flex items-center gap-2 text-[0.8125rem]">
          <input
            type="checkbox"
            checked={sendAsFile}
            onChange={(e) => setSendAsFile(e.target.checked)}
            className="accent-primary h-4 w-4"
          />
          Send as file
        </label>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onPasteInline(text)}
            disabled={!text}
            className="press focus-ring border border-[var(--fill-2)] text-foreground hover:bg-[var(--fill-4)] flex-1 rounded-lg py-2.5 text-[0.8125rem] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
          >
            Paste inline
          </button>
          <button
            onClick={confirm}
            disabled={!text}
            className="press focus-ring bg-primary text-primary-foreground hover:bg-primary/90 flex-1 rounded-lg py-2.5 text-[0.8125rem] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
          >
            Paste as file
          </button>
        </div>
      </div>
    </div>
  );
}

export interface TerminalHandle {
  sendCommand: (command: string) => void;
  sendInput: (data: string) => void;
  focus: () => void;
}

interface TerminalProps {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onBeforeUnmount?: (scrollState: TerminalScrollState) => void;
  initialScrollState?: TerminalScrollState;
  /**
   * Directory file drops should land in (usually the tmux terminal's
   * working_directory). Falls back to /tmp when absent.
   */
  workingDirectory?: string | null;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  function Terminal(
    {
      onConnected,
      onDisconnected,
      onBeforeUnmount,
      initialScrollState,
      workingDirectory,
    },
    ref
  ) {
    const terminalRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { isMobile } = useViewport();
    const { fontScale } = useFontScale();
    const { theme: currentTheme, resolvedTheme } = useTheme();
    const [selectMode, setSelectMode] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    // Long clipboard text captured from paste on mobile, shown in the
    // "Paste options" dialog; null means no dialog.
    const [longPasteText, setLongPasteText] = useState<string | null>(null);

    // Use the full theme string (e.g., "dark-purple") for terminal theming
    const terminalTheme = useMemo(() => {
      // For system theme, use the resolved theme
      if (currentTheme === "system") {
        return resolvedTheme || "dark";
      }
      return currentTheme || "dark";
    }, [currentTheme, resolvedTheme]);

    const {
      connectionState,
      isAtBottom,
      xtermRef,
      scrollToBottom,
      copySelection,
      sendInput,
      sendCommand,
      focus,
      reconnect,
    } = useTerminalConnection({
      terminalRef,
      onConnected,
      onDisconnected,
      onBeforeUnmount,
      initialScrollState,
      isMobile,
      fontScale,
      theme: terminalTheme,
      selectMode,
    });

    // Drop/paste uploads land in <cwd>/tmp, not the cwd root; without a
    // working directory the uploader falls back to /tmp.
    const targetDir = uploadTargetDir(workingDirectory);

    // Handle file drop - upload and insert path into terminal
    const handleFileDrop = useCallback(
      async (file: File) => {
        // Multiple files are processed sequentially by useFileDrop; failures
        // propagate so the hook can collect and report them.
        setIsUploading(true);
        try {
          const path = await uploadFileToTemp(file, {
            targetDir,
          });
          if (path) {
            sendInput(path);
            focus();
          }
        } finally {
          setIsUploading(false);
        }
      },
      [sendInput, focus, targetDir]
    );

    // Drag and drop for file uploads
    const { isDragging, dragHandlers } = useFileDrop(containerRef, handleFileDrop, {
      disabled: isUploading,
    });

    // Upload clipboard text as a .txt file into tmp and insert its path.
    const pasteTextAsFile = useCallback(
      async (text: string) => {
        setIsUploading(true);
        try {
          const path = await uploadTextAsPasteFile(text, { targetDir });
          if (path) {
            sendInput(path);
            focus();
          }
        } finally {
          setIsUploading(false);
        }
      },
      [sendInput, focus, targetDir]
    );

    // Intercept clipboard paste on the terminal container. Clipboard events
    // always target xterm's hidden textarea, which lives inside containerRef,
    // so capturing at the container is the reliable interception point. Local
    // capture listener fires before xterm's own paste listeners.
    const handlePasteCapture = useCallback(
      (event: ClipboardEvent) => {
        const files = event.clipboardData?.files
          ? Array.from(event.clipboardData.files)
          : [];

        if (files.length === 0) {
          // Text-only paste. Typing is never intercepted here: short pastes
          // keep xterm's default flow, and only long pastes are taken over.
          const text = event.clipboardData?.getData("text/plain") || "";
          if (text.length <= PASTE_AS_FILE_THRESHOLD) return;

          if (isMobile) {
            // Mobile: ask the user how to insert the long text. clipboardData
            // is available here from the paste event, so prefill the dialog.
            event.preventDefault();
            event.stopPropagation();
            setLongPasteText(text);
            return;
          }

          if (pasteLongAsFilePref()) {
            event.preventDefault();
            event.stopPropagation();
            void pasteTextAsFile(text);
          }
          // Preference disabled: old typing behavior applies (do nothing and
          // let xterm handle the paste).
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        // Process every pasted file sequentially, mirroring useFileDrop: each
        // failure is collected so one bad file never aborts the rest.
        (async () => {
          const errors: string[] = [];
          for (const file of files) {
            try {
              const path = await uploadFileToTemp(file, {
                targetDir,
              });
              if (path) {
                sendInput(path);
                focus();
              } else {
                errors.push(`${file.name}: upload failed`);
              }
            } catch (err) {
              errors.push(
                `${file.name}: ${
                  err instanceof Error ? err.message : String(err)
                }`
              );
            }
          }
          if (errors.length > 0) {
            toast.error(
              `Failed to upload ${errors.length} of ${files.length} pasted file(s)`,
              {
                description: errors.join("\n"),
              }
            );
          }
        })();
      },
      [sendInput, focus, targetDir, isMobile, pasteTextAsFile]
    );

    // Mobile long-paste dialog resolution handlers (see LongPasteDialog).
    const handleLongPasteAsFile = useCallback(
      (text: string) => {
        setLongPasteText(null);
        if (text.trim().length > 0) void pasteTextAsFile(text);
      },
      [pasteTextAsFile]
    );
    const handleLongPasteInline = useCallback(
      (text: string) => {
        setLongPasteText(null);
        if (text) {
          // Insert as if typed, matching the toolbar paste flow.
          for (const char of text) sendInput(char);
          focus();
        }
      },
      [sendInput, focus]
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      container.addEventListener("paste", handlePasteCapture, true);
      return () => {
        container.removeEventListener("paste", handlePasteCapture, true);
      };
    }, [handlePasteCapture]);

    // Expose imperative methods
    useImperativeHandle(ref, () => ({
      sendCommand,
      sendInput,
      focus,
    }));

    // Extract terminal text for select mode overlay
    const terminalText = useMemo(() => {
      if (!selectMode || !xtermRef.current) return "";

      const term = xtermRef.current;
      const buffer = term.buffer.active;
      const startRow = Math.max(0, buffer.baseY - 500);
      const endRow = buffer.baseY + term.rows;
      const lines: string[] = [];

      for (let i = startRow; i < endRow; i++) {
        const line = buffer.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }

      return lines.join("\n");
    }, [selectMode, xtermRef]);

    return (
      <div
        ref={containerRef}
        className="bg-background flex flex-col overflow-hidden"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
        }}
        {...dragHandlers}
      >
        {/* Terminal container - NO padding! FitAddon reads offsetHeight which includes padding */}
        <div
          ref={terminalRef}
          className={cn(
            "terminal-container min-h-0 w-full flex-1 overflow-hidden",
            selectMode && "ring-primary ring-2 ring-inset",
            isDragging && "ring-primary ring-2 ring-inset"
          )}
          onClick={focus}
          onTouchStart={selectMode ? (e) => e.stopPropagation() : undefined}
          onTouchEnd={selectMode ? (e) => e.stopPropagation() : undefined}
        />

        {/* Select mode overlay - shows terminal text in a selectable format */}
        {selectMode && (
          <div
            className="bg-background absolute inset-0 z-40 flex flex-col"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <div className="bg-primary text-primary-foreground flex items-center justify-between px-3 py-2 text-xs font-medium">
              <span>Select text below, then tap Copy</span>
              <button
                onClick={() => setSelectMode(false)}
                className="bg-primary-foreground/20 rounded px-2 py-0.5 font-mono text-xs"
              >
                Done
              </button>
            </div>
            <pre
              className="flex-1 overflow-auto p-3 font-mono text-xs break-all whitespace-pre-wrap select-text"
              style={{
                userSelect: "text",
                WebkitUserSelect: "text",
              }}
            >
              {terminalText}
            </pre>
          </div>
        )}

        {/* Drag and drop overlay */}
        {isDragging && (
          <div className="bg-primary/10 pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <div className="border-primary bg-background/90 rounded-lg border px-6 py-4 text-center">
              <Upload className="text-primary mx-auto mb-2 h-8 w-8" />
              <p className="text-sm font-medium">Drop file to upload</p>
            </div>
          </div>
        )}

        {/* Upload in progress overlay */}
        {isUploading && (
          <div className="bg-background/50 pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <div className="bg-background rounded-lg border px-6 py-4 text-center">
              <Loader2 className="text-primary mx-auto mb-2 h-6 w-6 animate-spin" />
              <p className="text-sm">Uploading file...</p>
            </div>
          </div>
        )}

        {/* Scroll to bottom button */}
        <ScrollToBottomButton visible={!isAtBottom} onClick={scrollToBottom} />

        {/* Mobile: Toolbar with special keys (native keyboard handles text) */}
        {isMobile && (
          <TerminalToolbar
            onKeyPress={sendInput}
            onCopy={copySelection}
            selectMode={selectMode}
            onSelectModeChange={setSelectMode}
          />
        )}

        {/* Mobile long paste: choose inline vs upload-as-file */}
        {isMobile && longPasteText !== null && (
          <LongPasteDialog
            initialText={longPasteText}
            onClose={() => setLongPasteText(null)}
            onPasteAsFile={handleLongPasteAsFile}
            onPasteInline={handleLongPasteInline}
          />
        )}

        {/* Connection status overlays */}
        {connectionState === "connecting" && (
          <div className="bg-background absolute inset-0 z-20 flex flex-col items-center justify-center gap-3">
            <div className="bg-primary animate-status-pulse h-1.5 w-1.5 rounded-full" />
            <span className="type-subhead text-muted-foreground">
              Connecting<span className="animate-caret-blink">_</span>
            </span>
          </div>
        )}

        {connectionState === "reconnecting" && (
          <div className="bg-background/80 text-status-waiting absolute top-4 left-4 flex items-center gap-2 rounded-full border border-[var(--fill-2)] px-3 py-1.5 text-[0.75rem] font-medium">
            <div className="bg-status-waiting h-1.5 w-1.5 animate-pulse" />
            Reconnecting
          </div>
        )}

        {/* Disconnected overlay - shows tap to reconnect button */}
        {connectionState === "disconnected" && (
          <button
            onClick={reconnect}
            className="bg-background/80 active:bg-background/90 absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 backdrop-blur-sm transition-all"
          >
            <WifiOff className="text-muted-foreground h-8 w-8" />
            <span className="text-foreground text-sm font-medium">
              Connection lost
            </span>
            <span className="bg-primary text-primary-foreground rounded-lg px-4 py-2">
              Tap to reconnect
            </span>
          </button>
        )}
      </div>
    );
  }
);
