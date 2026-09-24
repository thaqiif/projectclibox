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
import "@wterm/dom/css";
import { Copy, WifiOff, Upload, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { TerminalToolbar } from "./TerminalToolbar";
import { useTerminalConnection } from "./hooks";
import type { TerminalScrollState } from "./hooks";
import { useViewport } from "@/hooks/useViewport";
import { useFileDrop } from "@/hooks/useFileDrop";
import {
  pasteLongAsFilePref,
  pasteActionFor,
  isPasteEditorTarget,
  setPasteLongAsFilePref,
  shouldUploadPaste,
  uploadFileToTemp,
  uploadPasteWithInlineFallback,
  uploadTargetDir,
  uploadTextAsPasteFile,
} from "@/lib/file-upload";
import { useFontScale } from "@/contexts/FontScaleContext";
import { terminalHistoryText } from "./hooks/terminal-engine-adapter";

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
          data-terminal-paste-editor
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="placeholder:text-muted-foreground/70 focus-visible:border-ring/70 focus-visible:ring-ring/25 h-40 w-full resize-none rounded-lg border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 font-mono text-[0.75rem] outline-none focus-visible:ring-[3px]"
        />
        <label className="text-muted-foreground mt-3 flex items-center gap-2 text-[0.8125rem]">
          <input
            type="checkbox"
            checked={sendAsFile}
            onChange={(e) => {
              const checked = e.target.checked;
              setSendAsFile(checked);
              setPasteLongAsFilePref(checked);
            }}
            className="accent-primary h-4 w-4"
          />
          Use file for future long pastes
        </label>
        <div className="mt-3">
          <button
            onClick={confirm}
            disabled={!text}
            className="press focus-ring bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-lg py-2.5 text-[0.8125rem] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
          >
            {sendAsFile ? "Paste as file" : "Paste inline"}
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
  sessionName?: string;
  isActive?: boolean;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onTitle?: (title: string) => void;
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
      sessionName,
      isActive = true,
      onConnected,
      onDisconnected,
      onTitle,
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
    const [osc52Pending, setOsc52Pending] = useState<string | null>(null);
    const [osc52ManualText, setOsc52ManualText] = useState<string | null>(null);
    // Long clipboard text captured from paste on mobile, shown in the
    // "Paste options" dialog; null means no dialog.
    const [longPasteText, setLongPasteText] = useState<string | null>(null);

    const handleOsc52ClipboardWrite = useCallback((text: string) => {
      setOsc52Pending(text);
      setOsc52ManualText(null);
    }, []);

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
      coreRef,
      terminalInstanceRef,
      scrollToBottom,
      copySelection,
      sendInput,
      sendCommand,
      focus,
      reconnect,
      initializationError,
    } = useTerminalConnection({
      terminalRef,
      sessionName,
      isActive,
      onConnected,
      onDisconnected,
      onTitle,
      onBeforeUnmount,
      onClipboardWrite: handleOsc52ClipboardWrite,
      initialScrollState,
      isMobile,
      fontScale,
      theme: terminalTheme,
      selectMode,
    });

    useEffect(() => {
      setOsc52Pending(null);
      setOsc52ManualText(null);
    }, [sessionName]);

    const handleCopyOsc52 = useCallback(() => {
      if (osc52Pending === null) return;

      let clipboardWrite: Promise<void> | null = null;
      try {
        clipboardWrite = navigator.clipboard?.writeText
          ? navigator.clipboard.writeText(osc52Pending)
          : null;
      } catch {
        // A browser can throw synchronously when clipboard access is blocked.
      }

      // execCommand is the synchronous, gesture-bound fallback for browsers
      // without the Clipboard API or pages where it is denied.
      const textarea = document.createElement("textarea");
      textarea.value = osc52Pending;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.select();
      let legacyCopied = false;
      try {
        legacyCopied = document.execCommand("copy");
      } catch {
        // Keep the text available in the manual-copy panel below.
      }
      textarea.remove();

      if (legacyCopied) {
        setOsc52Pending(null);
        setOsc52ManualText(null);
        return;
      }

      if (clipboardWrite) {
        void clipboardWrite.then(
          () => {
            setOsc52Pending(null);
            setOsc52ManualText(null);
          },
          () => {
            if (!legacyCopied) setOsc52ManualText(osc52Pending);
          }
        );
      } else {
        setOsc52ManualText(osc52Pending);
      }
    }, [osc52Pending]);

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
          const result = await uploadPasteWithInlineFallback(
            text,
            // quiet: the fallback below reports this failure once, with what
            // actually happened to the text.
            () => uploadTextAsPasteFile(text, { targetDir, quiet: true }),
            (inlineText) => sendInput(inlineText)
          );
          if (result.path) {
            sendInput(result.path);
            focus();
            return;
          }
          if (result.error) console.error("Paste upload failed:", result.error);
          focus();
          toast.warning("Paste upload failed; pasted text inline instead");
        } finally {
          setIsUploading(false);
        }
      },
      [sendInput, focus, targetDir]
    );

    // Intercept clipboard paste on the terminal container. Clipboard events
    // always target WTerm's hidden textarea, which lives inside containerRef,
    // so capturing at the container is the reliable interception point. Local
    // capture listener fires before WTerm's paste handler.
    const handlePasteCapture = useCallback(
      (event: ClipboardEvent) => {
        // Paste dialogs live inside the terminal container. Let their textareas
        // receive native paste, including the clipboardData-null browser path.
        if (isPasteEditorTarget(event.target)) return;

        const files = event.clipboardData?.files
          ? Array.from(event.clipboardData.files)
          : [];

        const text = event.clipboardData?.getData("text/plain") || "";
        const action = pasteActionFor({
          hasFiles: files.length > 0,
          text,
          isMobile,
          preferFile: pasteLongAsFilePref(),
        });

        // ignore: short text keeps WTerm's default flow, and a desktop user
        // who turned the preference off keeps the old inline paste.
        if (action === "ignore") return;

        if (action === "dialog") {
          // Mobile: ask the user how to insert the long text. clipboardData
          // is available here from the paste event, so prefill the dialog.
          event.preventDefault();
          event.stopPropagation();
          setLongPasteText(text);
          return;
        }

        if (action === "upload-file") {
          event.preventDefault();
          event.stopPropagation();
          void pasteTextAsFile(text);
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
        // Any non-empty text is kept: trimming made a whitespace-only paste
        // vanish without a trace.
        if (text.length > 0) void pasteTextAsFile(text);
      },
      [pasteTextAsFile]
    );
    const handleLongPasteInline = useCallback(
      (text: string) => {
        setLongPasteText(null);
        if (text) {
          sendInput(text);
          focus();
        }
      },
      [sendInput, focus]
    );

    // The toolbar Clipboard button and its manual dialog are paste actions,
    // not keyboard input. Apply the same exact threshold as a native paste.
    const handleMobilePasteText = useCallback(
      (text: string) => {
        if (shouldUploadPaste(text)) setLongPasteText(text);
        else if (text) {
          sendInput(text);
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

    const handleSelectAllKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null;
        if (
          !terminalRef.current?.contains(document.activeElement) ||
          target?.closest("[data-terminal-paste-editor]") ||
          !(event.metaKey || event.ctrlKey) ||
          event.key.toLowerCase() !== "a"
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setSelectMode(true);
      },
      []
    );

    const handleSelectModeChange = useCallback(
      (enabled: boolean) => {
        setSelectMode(enabled);
        if (enabled) return;

        // The selectable overlay takes focus away from WTerm. Ask it to paint
        // its existing Ghostty state after the overlay closes, then restore
        // keyboard focus on desktop. Do not focus the hidden textarea on
        // mobile because that opens the on-screen keyboard again.
        requestAnimationFrame(() => {
          const terminal = terminalInstanceRef.current;
          terminal?.write("");
          if (!isMobile) terminal?.focus();
        });
      },
      [isMobile, terminalInstanceRef]
    );

    // Expose imperative methods
    useImperativeHandle(ref, () => ({
      sendCommand,
      sendInput,
      focus,
    }));

    // Extract terminal text for select mode overlay
    const terminalText = useMemo(() => {
      if (!selectMode || !coreRef.current) return "";
      return terminalHistoryText(coreRef.current);
    }, [selectMode, coreRef]);

    return (
      <div
        ref={containerRef}
        className="bg-background flex h-full min-h-0 min-w-0 w-full max-w-full flex-col overflow-hidden"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
        }}
        {...dragHandlers}
        onKeyDownCapture={handleSelectAllKeyDown}
      >
        {/* Terminal container - NO padding! FitAddon reads offsetHeight which includes padding */}
        <div
          ref={terminalRef}
          className={cn(
            "terminal-container min-h-0 min-w-0 w-full flex-1 overflow-hidden",
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
                type="button"
                onClick={() => handleSelectModeChange(false)}
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

        {osc52Pending !== null && (
          <div className="bg-background/95 absolute top-3 right-3 z-20 flex max-w-[min(32rem,calc(100%-1.5rem))] items-center gap-2 rounded-lg border border-[var(--fill-2)] px-3 py-2 text-xs shadow-lg">
            <span className="min-w-0 flex-1 truncate">Terminal requested clipboard access</span>
            <button
              onClick={handleCopyOsc52}
              className="bg-primary text-primary-foreground flex shrink-0 items-center gap-1 rounded px-2 py-1 font-medium"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
            <button
              aria-label="Dismiss clipboard request"
              onClick={() => {
                setOsc52Pending(null);
                setOsc52ManualText(null);
              }}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {osc52ManualText !== null && (
          <div className="bg-background/95 absolute top-14 right-3 z-20 flex w-[min(32rem,calc(100%-1.5rem))] flex-col gap-2 rounded-lg border border-[var(--fill-2)] p-3 text-xs shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <span>Clipboard access was denied. Select and copy this text.</span>
              <button
                aria-label="Close manual clipboard text"
                onClick={() => setOsc52ManualText(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              aria-label="Text requested by terminal"
              readOnly
              value={osc52ManualText}
              onFocus={(event) => event.currentTarget.select()}
              className="max-h-32 min-h-16 w-full resize-y overflow-auto rounded border border-[var(--fill-2)] bg-[var(--fill-4)] p-2 font-mono text-xs select-text"
            />
          </div>
        )}

        {/* Mobile: Toolbar with special keys (native keyboard handles text) */}
        {isMobile && (
          <TerminalToolbar
            onKeyPress={sendInput}
            onPasteText={handleMobilePasteText}
            onCopy={copySelection}
            selectMode={selectMode}
            onSelectModeChange={handleSelectModeChange}
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

        {connectionState === "error" && (
          <div className="bg-background/95 absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <WifiOff className="text-muted-foreground h-8 w-8" />
            <span className="text-foreground text-sm font-medium">
              Terminal connection failed
            </span>
            {initializationError && (
              <span className="text-muted-foreground max-w-md text-xs">
                {initializationError}
              </span>
            )}
            <button
              onClick={reconnect}
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }
);
