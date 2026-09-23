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
import { Paperclip, WifiOff, Upload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { TerminalToolbar } from "./TerminalToolbar";
import { useTerminalConnection } from "./hooks";
import type { TerminalScrollState } from "./hooks";
import { useViewport } from "@/hooks/useViewport";
import { useFileDrop } from "@/hooks/useFileDrop";
import { uploadFileToTemp } from "@/lib/file-upload";
import { FilePicker } from "@/components/FilePicker";
import { useFontScale } from "@/contexts/FontScaleContext";

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
  /** Show image picker button (default: true) */
  showImageButton?: boolean;
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
      showImageButton = true,
      workingDirectory,
    },
    ref
  ) {
    const terminalRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { isMobile } = useViewport();
    const { fontScale } = useFontScale();
    const { theme: currentTheme, resolvedTheme } = useTheme();
    const [showFilePicker, setShowFilePicker] = useState(false);
    const [selectMode, setSelectMode] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

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

    // Handle image selection - paste file path into terminal
    const handleImageSelect = useCallback(
      (filePath: string) => {
        sendInput(filePath);
        setShowFilePicker(false);
        focus();
      },
      [sendInput, focus]
    );

    // Handle file drop - upload and insert path into terminal
    const handleFileDrop = useCallback(
      async (file: File) => {
        // Multiple files are processed sequentially by useFileDrop; failures
        // propagate so the hook can collect and report them.
        setIsUploading(true);
        try {
          const path = await uploadFileToTemp(file, {
            // Drop straight into the terminal's working directory; with no
            // directory known, the upload falls back to /tmp.
            targetDir: workingDirectory || undefined,
          });
          if (path) {
            sendInput(path);
            focus();
          }
        } finally {
          setIsUploading(false);
        }
      },
      [sendInput, focus, workingDirectory]
    );

    // Drag and drop for file uploads
    const { isDragging, dragHandlers } = useFileDrop(
      containerRef,
      handleFileDrop,
      { disabled: isUploading || showFilePicker }
    );

    // Intercept clipboard paste on the terminal container. Clipboard events
    // always target xterm's hidden textarea, which lives inside containerRef,
    // so capturing at the container is the reliable interception point. Local
    // capture listener fires before xterm's own paste listeners; without image
    // files we do nothing (default text paste continues into xterm).
    const handlePasteCapture = useCallback(
      (event: ClipboardEvent) => {
        const files = event.clipboardData?.files
          ? Array.from(event.clipboardData.files)
          : [];
        // Only intercept when the clipboard carries real files (screenshots /
        // images / PDFs). Text-only pastes keep xterm's normal paste flow.
        if (files.length === 0) return;

        event.preventDefault();
        event.stopPropagation();

        // Process every pasted file sequentially, mirroring useFileDrop: each
        // failure is collected so one bad file never aborts the rest.
        (async () => {
          const errors: string[] = [];
          for (const file of files) {
            try {
              const path = await uploadFileToTemp(file, {
                // Paste lands in the terminal's working directory, like drag
                // and drop; without one, uploads fall back to /tmp.
                targetDir: workingDirectory || undefined,
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
      [sendInput, focus, workingDirectory]
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

        {/* File picker button - desktop only */}
        {!isMobile && showImageButton && (
          <button
            onClick={() => setShowFilePicker(true)}
            className="bg-secondary absolute top-3 right-3 z-40 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--fill-1)] transition-colors hover:bg-[var(--fill-3)]"
            title="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
        )}

        {/* Image picker modal */}
        {showFilePicker && (
          <FilePicker
            initialPath="~"
            onSelect={handleImageSelect}
            onClose={() => setShowFilePicker(false)}
          />
        )}

        {/* Scroll to bottom button */}
        <ScrollToBottomButton visible={!isAtBottom} onClick={scrollToBottom} />

        {/* Mobile: Toolbar with special keys (native keyboard handles text) */}
        {isMobile && (
          <TerminalToolbar
            onKeyPress={sendInput}
            onFilePicker={() => setShowFilePicker(true)}
            onCopy={copySelection}
            selectMode={selectMode}
            onSelectModeChange={setSelectMode}
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
