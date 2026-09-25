"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clipboard,
  X,
  Send,
  Mic,
  MicOff,
  FileText,
  Plus,
  Trash2,
  MousePointer2,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { terminalKeySequence } from "./terminal-key-sequences";

interface TerminalToolbarProps {
  onKeyPress: (key: string) => void;
  /** Clipboard/modal text, kept separate from physical keyboard input. */
  onPasteText: (text: string) => void;
  onCopy?: () => boolean; // Returns true if selection was copied
  selectMode?: boolean;
  onSelectModeChange?: (enabled: boolean) => void;
}

interface Snippet {
  id: string;
  name: string;
  content: string;
}

const SNIPPETS_STORAGE_KEY = "terminal-snippets";

const DEFAULT_SNIPPETS: Snippet[] = [
  // Handy shell/editor prompts
  { id: "default-1", name: "Continue", content: "continue" },
  { id: "default-2", name: "Yes", content: "yes" },
  { id: "default-3", name: "No", content: "no" },
  {
    id: "default-4",
    name: "Explain this",
    content: "explain what this code does",
  },
  { id: "default-5", name: "Fix errors", content: "fix the errors" },
  {
    id: "default-6",
    name: "Run tests",
    content: "run the tests and fix any failures",
  },
  // Common commands
  { id: "default-7", name: "List files", content: "ls -la" },
  { id: "default-8", name: "NPM install", content: "npm install" },
];

function getStoredSnippets(): Snippet[] {
  if (typeof window === "undefined") return DEFAULT_SNIPPETS;
  try {
    const stored = localStorage.getItem(SNIPPETS_STORAGE_KEY);
    if (!stored) {
      // First time - save defaults
      saveSnippets(DEFAULT_SNIPPETS);
      return DEFAULT_SNIPPETS;
    }
    return JSON.parse(stored);
  } catch {
    return DEFAULT_SNIPPETS;
  }
}

function saveSnippets(snippets: Snippet[]) {
  localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));
}

// Snippets modal for saving/inserting common commands
function SnippetsModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
}) {
  const [snippets, setSnippets] = useState<Snippet[]>(() =>
    getStoredSnippets()
  );
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");

  const handleAdd = () => {
    if (newName.trim() && newContent.trim()) {
      const newSnippet: Snippet = {
        id: Date.now().toString(),
        name: newName.trim(),
        content: newContent.trim(),
      };
      const updated = [...snippets, newSnippet];
      setSnippets(updated);
      saveSnippets(updated);
      setNewName("");
      setNewContent("");
      setIsAdding(false);
    }
  };

  const handleDelete = (id: string) => {
    const updated = snippets.filter((s) => s.id !== id);
    setSnippets(updated);
    saveSnippets(updated);
  };

  const handleInsert = (content: string) => {
    onInsert(content);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="animate-in fade-in-0 fixed inset-0 z-50 flex items-end justify-center bg-black/35 duration-200"
      onClick={onClose}
    >
      <div
        className="glass-thick glass-float animate-in slide-in-from-bottom flex max-h-[78dvh] w-full flex-col rounded-t-md rounded-b-none border-x-0 border-b-0 duration-200 sm:max-w-md sm:rounded-md sm:border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.014em]">
            Snippets
          </h2>
          <div className="flex items-center">
            <button
              onClick={() => setIsAdding(!isAdding)}
              className="press focus-ring text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-sm transition-colors hover:bg-[var(--fill-3)]"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="press focus-ring text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-sm transition-colors hover:bg-[var(--fill-3)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Add new snippet form */}
        {isAdding && (
          <div className="px-4 pb-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Snippet name..."
              className="placeholder:text-muted-foreground/70 focus-visible:border-ring/70 focus-visible:ring-ring/25 mb-2 w-full rounded-sm border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 text-[0.875rem] outline-none focus-visible:ring-[3px]"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Command or text..."
              className="placeholder:text-muted-foreground/70 focus-visible:border-ring/70 focus-visible:ring-ring/25 h-20 w-full resize-none rounded-sm border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 font-mono text-[0.75rem] outline-none focus-visible:ring-[3px]"
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || !newContent.trim()}
              className="press focus-ring bg-primary text-primary-foreground hover:bg-primary/90 mt-2 w-full rounded-sm py-2.5 text-[0.8125rem] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
            >
              Save Snippet
            </button>
          </div>
        )}

        {/* Snippets list */}
        <div className="scrollbar-thin flex-1 overflow-y-auto px-1.5 pb-[env(safe-area-inset-bottom)]">
          {snippets.length === 0 ? (
            <div className="text-muted-foreground px-4 py-10 text-center text-[0.8125rem]">
              No snippets yet. Tap + to add one.
            </div>
          ) : (
            snippets.map((snippet) => (
              <div
                key={snippet.id}
                className="flex items-center gap-2 rounded-sm px-3 py-2.5 transition-colors active:bg-[var(--fill-3)]"
              >
                <button
                  onClick={() => handleInsert(snippet.content)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="text-foreground truncate text-[0.8125rem] font-medium">
                    {snippet.name}
                  </div>
                  <div className="text-muted-foreground truncate font-mono text-[0.75rem]">
                    {snippet.content}
                  </div>
                </button>
                <button
                  onClick={() => handleDelete(snippet.id)}
                  className="press focus-ring text-muted-foreground hover:text-destructive hover:bg-destructive/16 flex size-8 items-center justify-center rounded-sm transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Paste modal for when clipboard API isn't available
function PasteModal({
  open,
  onClose,
  onPaste,
}: {
  open: boolean;
  onClose: () => void;
  onPaste: (text: string) => void;
}) {
  const [text, setText] = useState("");

  const handleSend = () => {
    if (text) {
      onPaste(text);
      setText("");
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="animate-in fade-in-0 fixed inset-0 z-50 flex items-end justify-center bg-black/35 duration-200 sm:items-center"
      onClick={onClose}
    >
      <div
        className="glass-thick glass-float lift-in w-full max-w-md rounded-t-md rounded-b-none border-x-0 border-b-0 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:w-[90%] sm:rounded-md sm:border sm:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.014em]">
            Paste
          </h2>
          <button
            onClick={onClose}
            className="press focus-ring text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-sm transition-colors hover:bg-[var(--fill-3)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          data-terminal-paste-editor
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData?.getData("text");
            if (pasted) {
              e.preventDefault();
              setText((prev) => prev + pasted);
            }
          }}
          placeholder="Tap here, then long-press to paste..."
          autoFocus
          className="placeholder:text-muted-foreground/70 focus-visible:border-ring/70 focus-visible:ring-ring/25 h-24 w-full resize-none rounded-sm border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 font-mono text-[0.75rem] outline-none focus-visible:ring-[3px]"
        />
        <button
          onClick={handleSend}
          disabled={!text}
          className="press focus-ring bg-primary text-primary-foreground hover:bg-primary/90 mt-3 flex w-full items-center justify-center gap-2 rounded-sm py-2.5 text-[0.8125rem] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
          Send to Terminal
        </button>
      </div>
    </div>
  );
}

export function TerminalToolbar({
  onKeyPress,
  onPasteText,
  onCopy,
  selectMode = false,
  onSelectModeChange,
}: TerminalToolbarProps) {
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showSnippetsModal, setShowSnippetsModal] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Send text character-by-character to terminal
  const sendText = useCallback(
    (text: string) => {
      for (const char of text) {
        onKeyPress(char);
      }
    },
    [onKeyPress]
  );

  const {
    isListening,
    isSupported: isMicSupported,
    toggle: toggleMic,
  } = useSpeechRecognition(sendText);

  // Handle paste - try clipboard API first, fall back to modal
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (text) {
        onPasteText(text);
        return;
      }
    } catch {
      // Clipboard API failed or unavailable
    }
    setShowPasteModal(true);
  }, [onPasteText]);

  // Handle copy with visual feedback
  const handleCopy = useCallback(() => {
    if (onCopy?.()) {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1000);
    }
  }, [onCopy]);

  // Virtual modifiers also apply to the next native keyboard key. iOS soft
  // keyboards may skip keydown for printable text, so cover beforeinput too.
  useEffect(() => {
    if (!shiftActive && !ctrlActive && !altActive) return;
    const modifiers = { shift: shiftActive, ctrl: ctrlActive, alt: altActive };
    const clear = () => {
      setShiftActive(false);
      setCtrlActive(false);
      setAltActive(false);
    };
    const isTerminalInput = (target: EventTarget | null) =>
      target instanceof HTMLTextAreaElement &&
      target.parentElement?.classList.contains("wterm");
    let handledPrintableKeyDown = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTerminalInput(event.target) || event.isComposing) return;
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      // The mobile Backspace bridge owns delete repeats and their input
      // events; intercepting the first key here would send it twice.
      if (event.key === "Backspace") {
        clear();
        return;
      }
      const sequence = terminalKeySequence(event.key, modifiers);
      if (sequence === null) return;
      handledPrintableKeyDown = event.key.length === 1;
      event.preventDefault();
      event.stopPropagation();
      onKeyPress(sequence);
      clear();
    };
    const onBeforeInput = (event: InputEvent) => {
      if (
        !isTerminalInput(event.target) ||
        event.isComposing ||
        event.inputType !== "insertText" ||
        !event.data
      )
        return;
      if (handledPrintableKeyDown) {
        handledPrintableKeyDown = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const sequence = terminalKeySequence(event.data, modifiers);
      if (sequence === null) return;
      event.preventDefault();
      event.stopPropagation();
      onKeyPress(sequence);
      clear();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("beforeinput", onBeforeInput, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("beforeinput", onBeforeInput, true);
    };
  }, [shiftActive, ctrlActive, altActive, onKeyPress]);

  const modifiers = { shift: shiftActive, ctrl: ctrlActive, alt: altActive };
  const clearModifiers = () => {
    setShiftActive(false);
    setCtrlActive(false);
    setAltActive(false);
  };
  const pressToolbarKey = (key: string) => {
    const sequence = terminalKeySequence(key, modifiers);
    if (sequence) onKeyPress(sequence);
    clearModifiers();
  };

  // Keep taps as native clicks for keyboard/assistive-tech support. A
  // stationary pointer hold starts typematic repeat after 300ms; moving
  // 10px cancels before any key is sent so horizontal scrolling is safe.
  const KEY_REPEAT_MOVE_THRESHOLD = 10;
  const keyRepeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRepeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const keyRepeatPointerRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const keyRepeatStartActionRef = useRef<(() => void) | null>(null);
  const suppressKeyRepeatClickRef = useRef(false);
  const cleanupKeyRepeat = useCallback(() => {
    if (keyRepeatTimerRef.current !== null) {
      clearTimeout(keyRepeatTimerRef.current);
      keyRepeatTimerRef.current = null;
    }
    if (keyRepeatIntervalRef.current !== null) {
      clearInterval(keyRepeatIntervalRef.current);
      keyRepeatIntervalRef.current = null;
    }
    keyRepeatPointerRef.current = null;
    keyRepeatStartActionRef.current = null;
  }, []);
  useEffect(() => cleanupKeyRepeat, [cleanupKeyRepeat]);
  const startKeyRepeat = useCallback(
    (
      key: string,
      pointerId: number,
      clientX: number,
      clientY: number,
      onRepeatStart?: () => void
    ) => {
      cleanupKeyRepeat();
      suppressKeyRepeatClickRef.current = false;
      keyRepeatPointerRef.current = {
        pointerId,
        startX: clientX,
        startY: clientY,
      };
      keyRepeatStartActionRef.current = onRepeatStart ?? null;
      keyRepeatTimerRef.current = setTimeout(() => {
        keyRepeatTimerRef.current = null;
        if (!keyRepeatPointerRef.current) return;
        suppressKeyRepeatClickRef.current = true;
        keyRepeatStartActionRef.current?.();
        keyRepeatStartActionRef.current = null;
        onKeyPress(key);
        keyRepeatIntervalRef.current = setInterval(() => onKeyPress(key), 50);
      }, 300);
    },
    [cleanupKeyRepeat, onKeyPress]
  );
  const stopKeyRepeat = useCallback(() => {
    cleanupKeyRepeat();
  }, [cleanupKeyRepeat]);
  const cancelKeyRepeat = useCallback(
    (suppressClick: boolean) => {
      if (suppressClick && keyRepeatPointerRef.current) {
        suppressKeyRepeatClickRef.current = true;
      }
      cleanupKeyRepeat();
    },
    [cleanupKeyRepeat]
  );
  const trackKeyRepeatPointer = useCallback(
    (pointerId: number, clientX: number, clientY: number) => {
      const pointer = keyRepeatPointerRef.current;
      if (!pointer || pointer.pointerId !== pointerId) return;
      if (
        Math.hypot(clientX - pointer.startX, clientY - pointer.startY) >=
        KEY_REPEAT_MOVE_THRESHOLD
      ) {
        cancelKeyRepeat(true);
      }
    },
    [cancelKeyRepeat]
  );
  const consumeSuppressedClick = useCallback(() => {
    const suppress = suppressKeyRepeatClickRef.current;
    suppressKeyRepeatClickRef.current = false;
    return suppress;
  }, []);

  const buttons = [
    { label: "Esc", key: "Escape" },
    { label: "^C", key: "ControlC", highlight: true },
    { label: "Tab", key: "Tab" },
    { label: "⇧Tab", key: "ShiftTab" },
    { label: "↵ NL", key: "Newline" },
    { label: "←", key: "ArrowLeft" },
    { label: "→", key: "ArrowRight" },
    { label: "↑", key: "ArrowUp" },
    { label: "↓", key: "ArrowDown" },
  ];

  return (
    <>
      <PasteModal
        open={showPasteModal}
        onClose={() => setShowPasteModal(false)}
        onPaste={onPasteText}
      />
      <SnippetsModal
        open={showSnippetsModal}
        onClose={() => setShowSnippetsModal(false)}
        onInsert={sendText}
      />
      <div
        // Opaque for the same reason as the mobile header: this row sits on the
        // bottom viewport edge, under the home indicator in a saved-to-home-
        // screen iOS session.
        className="terminal-toolbar glass-edge-top scrollbar-none relative z-10 flex items-stretch gap-1 overflow-x-auto bg-[var(--shell-bar)] px-1.5 pt-1.5"
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Mic button */}
        {isMicSupported && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleMic();
            }}
            className={cn(
              "press focus-ring relative flex h-11 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-2 transition-colors duration-200",
              isListening
                ? "bg-destructive/16 text-destructive"
                : "text-muted-foreground hover:text-foreground hover:bg-[var(--fill-3)]"
            )}
          >
            {isListening ? (
              <MicOff className="h-4 w-4 animate-pulse" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
        )}

        {/* Paste button */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            handlePaste();
          }}
          className="press focus-ring text-muted-foreground hover:text-foreground relative flex h-11 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-2 transition-colors duration-200 hover:bg-[var(--fill-3)]"
        >
          <Clipboard className="h-4 w-4" />
        </button>

        {/* Select mode toggle */}
        {onSelectModeChange && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onSelectModeChange(!selectMode);
            }}
            className={cn(
              "press focus-ring relative flex h-11 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-2 transition-colors duration-200",
              selectMode
                ? "bg-primary/16 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-[var(--fill-3)]"
            )}
          >
            <MousePointer2 className="h-4 w-4" />
          </button>
        )}

        {/* Copy button - shown when in select mode */}
        {selectMode && onCopy && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className={cn(
              "press focus-ring relative flex h-11 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-2 transition-colors duration-200",
              copyFeedback
                ? "bg-status-running/16 text-status-running"
                : "text-muted-foreground hover:text-foreground hover:bg-[var(--fill-3)]"
            )}
          >
            <Copy className="h-4 w-4" />
          </button>
        )}

        {/* Snippets button */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setShowSnippetsModal(true);
          }}
          className="press focus-ring text-muted-foreground hover:text-foreground relative flex h-11 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-2 transition-colors duration-200 hover:bg-[var(--fill-3)]"
        >
          <FileText className="h-4 w-4" />
        </button>

        {/* Shift toggle */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setShiftActive(!shiftActive);
          }}
          className={cn(
            "press focus-ring relative flex h-11 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-2 text-[0.9375rem] transition-colors duration-200",
            shiftActive
              ? "bg-primary/16 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-[var(--fill-3)]"
          )}
        >
          ⇧
        </button>

        {/* Ctrl modifier toggle - next physical key becomes a control char */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setCtrlActive((v) => !v);
          }}
          className={cn(
            "press focus-ring relative flex h-11 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-2 text-[0.9375rem] transition-colors duration-200",
            ctrlActive
              ? "bg-primary/16 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-[var(--fill-3)]"
          )}
        >
          ⌃
        </button>

        {/* Alt modifier toggle - next physical key is sent ESC-prefixed (Meta) */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setAltActive((v) => !v);
          }}
          className={cn(
            "press focus-ring relative flex h-11 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-2 text-[0.9375rem] transition-colors duration-200",
            altActive
              ? "bg-primary/16 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-[var(--fill-3)]"
          )}
        >
          ⌥
        </button>

        {/* Enter key - sends \n if shift active, \r otherwise */}
        <button
          type="button"
          onPointerDown={(e) => {
            if (!e.isPrimary || e.button !== 0) return;
            const key = terminalKeySequence("Enter", modifiers) ?? "\r";
            startKeyRepeat(
              key,
              e.pointerId,
              e.clientX,
              e.clientY,
              clearModifiers
            );
          }}
          onPointerMove={(e) => {
            trackKeyRepeatPointer(e.pointerId, e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            stopKeyRepeat();
          }}
          onPointerLeave={() => {
            cancelKeyRepeat(true);
          }}
          onPointerCancel={() => {
            cancelKeyRepeat(true);
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            if (e.detail !== 0 && consumeSuppressedClick()) return;
            pressToolbarKey("Enter");
          }}
          className="press focus-ring text-muted-foreground hover:text-foreground active:text-foreground relative flex h-11 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-2 text-[0.9375rem] transition-colors duration-200 hover:bg-[var(--fill-3)]"
        >
          ↵
        </button>

        {/* Special keys */}
        {buttons.map((btn) => (
          <button
            type="button"
            key={btn.label}
            onPointerDown={(e) => {
              if (!e.isPrimary || e.button !== 0) return;
              const key = terminalKeySequence(btn.key, modifiers);
              if (key)
                startKeyRepeat(
                  key,
                  e.pointerId,
                  e.clientX,
                  e.clientY,
                  clearModifiers
                );
            }}
            onPointerMove={(e) => {
              trackKeyRepeatPointer(e.pointerId, e.clientX, e.clientY);
            }}
            onPointerUp={() => {
              stopKeyRepeat();
            }}
            onPointerLeave={() => {
              cancelKeyRepeat(true);
            }}
            onPointerCancel={() => {
              cancelKeyRepeat(true);
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              if (e.detail !== 0 && consumeSuppressedClick()) return;
              pressToolbarKey(btn.key);
            }}
            className={cn(
              "press focus-ring relative flex h-11 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-2 text-[0.75rem] font-medium transition-colors duration-200",
              "active:text-foreground hover:bg-[var(--fill-3)]",
              btn.highlight
                ? "text-destructive"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </>
  );
}
