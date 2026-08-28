"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clipboard,
  X,
  Send,
  Mic,
  MicOff,
  Paperclip,
  FileText,
  Plus,
  Trash2,
  MousePointer2,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

// ANSI escape sequences
const SPECIAL_KEYS = {
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  LEFT: "\x1b[D",
  RIGHT: "\x1b[C",
  ESC: "\x1b",
  TAB: "\t",
  SHIFT_TAB: "\x1b[Z",
  NEWLINE: "\x1b\r",
  CTRL_C: "\x03",
  CTRL_D: "\x04",
  CTRL_Z: "\x1a",
  CTRL_L: "\x0c",
} as const;

interface TerminalToolbarProps {
  onKeyPress: (key: string) => void;
  onFilePicker?: () => void;
  onCopy?: () => boolean; // Returns true if selection was copied
  selectMode?: boolean;
  onSelectModeChange?: (enabled: boolean) => void;
  visible?: boolean;
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
      className="animate-in fade-in-0 fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[3px] duration-200"
      onClick={onClose}
    >
      <div
        className="glass-thick glass-float animate-in slide-in-from-bottom flex max-h-[70vh] w-full flex-col rounded-t-2xl duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
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
              className="press focus-ring text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--fill-3)]"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="press focus-ring text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--fill-3)]"
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
              className="placeholder:text-muted-foreground/70 focus-visible:border-ring/70 focus-visible:ring-ring/25 mb-2 w-full rounded-lg border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 text-[0.875rem] outline-none focus-visible:ring-[3px]"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Command or text..."
              className="placeholder:text-muted-foreground/70 focus-visible:border-ring/70 focus-visible:ring-ring/25 h-20 w-full resize-none rounded-lg border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 font-mono text-[0.75rem] outline-none focus-visible:ring-[3px]"
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || !newContent.trim()}
              className="press focus-ring bg-primary text-primary-foreground hover:bg-primary/90 mt-2 w-full rounded-lg py-2.5 text-[0.8125rem] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
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
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors active:bg-[var(--fill-3)]"
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
                  className="press focus-ring text-muted-foreground hover:text-destructive hover:bg-destructive/16 flex size-8 items-center justify-center rounded-full transition-colors"
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
      className="animate-in fade-in-0 fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[3px] duration-200"
      onClick={onClose}
    >
      <div
        className="glass-thick glass-float lift-in w-[90%] max-w-md rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.014em]">
            Paste
          </h2>
          <button
            onClick={onClose}
            className="press focus-ring text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--fill-3)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
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
          className="placeholder:text-muted-foreground/70 focus-visible:border-ring/70 focus-visible:ring-ring/25 h-24 w-full resize-none rounded-lg border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 font-mono text-[0.75rem] outline-none focus-visible:ring-[3px]"
        />
        <button
          onClick={handleSend}
          disabled={!text}
          className="press focus-ring bg-primary text-primary-foreground hover:bg-primary/90 mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[0.8125rem] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
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
  onFilePicker,
  onCopy,
  selectMode = false,
  onSelectModeChange,
  visible = true,
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
        sendText(text);
        return;
      }
    } catch {
      // Clipboard API failed or unavailable
    }
    setShowPasteModal(true);
  }, [sendText]);

  // Handle copy with visual feedback
  const handleCopy = useCallback(() => {
    if (onCopy?.()) {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1000);
    }
  }, [onCopy]);

  // Ctrl modifier: when armed, the next physical keystroke is sent as a
  // control character (Ctrl+A..Z and @ [ \\ ] ^ _ ?). Captured at the window
  // level so it works with the native keyboard; mobile soft keyboards may
  // not emit keydown, which is why the on-screen ^C/^D buttons remain.
  useEffect(() => {
    if (!ctrlActive) return;
    const handler = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta")
        return;
      e.preventDefault();
      e.stopPropagation();
      if (k.length === 1) {
        if (k === " ") onKeyPress("\x00");
        else if (k === "?") onKeyPress("\x7f");
        else {
          const c = k.toUpperCase().charCodeAt(0);
          if (c >= 64 && c <= 95) onKeyPress(String.fromCharCode(c & 0x1f));
        }
      }
      setCtrlActive(false);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [ctrlActive, onKeyPress]);

  // Alt/Option modifier: when armed, the next physical key is sent ESC-
  // prefixed (Meta). This supports Alt+Enter and word navigation in common
  // shells and terminal applications. Same window-level capture as Ctrl.
  useEffect(() => {
    if (!altActive) return;
    const handler = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta")
        return;
      e.preventDefault();
      e.stopPropagation();
      if (k === "Enter") onKeyPress("\x1b\r");
      else if (k.length === 1) onKeyPress("\x1b" + k);
      setAltActive(false);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [altActive, onKeyPress]);

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

  if (!visible) return null;

  const buttons = [
    { label: "Esc", key: SPECIAL_KEYS.ESC },
    { label: "^C", key: SPECIAL_KEYS.CTRL_C, highlight: true },
    { label: "Tab", key: SPECIAL_KEYS.TAB },
    { label: "⇧Tab", key: SPECIAL_KEYS.SHIFT_TAB },
    { label: "↵ NL", key: SPECIAL_KEYS.NEWLINE },
    { label: "←", key: SPECIAL_KEYS.LEFT },
    { label: "→", key: SPECIAL_KEYS.RIGHT },
    { label: "↑", key: SPECIAL_KEYS.UP },
    { label: "↓", key: SPECIAL_KEYS.DOWN },
  ];

  return (
    <>
      <PasteModal
        open={showPasteModal}
        onClose={() => setShowPasteModal(false)}
        onPaste={sendText}
      />
      <SnippetsModal
        open={showSnippetsModal}
        onClose={() => setShowSnippetsModal(false)}
        onInsert={sendText}
      />
      <div
        className="glass glass-edge-top scrollbar-none relative z-10 flex items-stretch gap-1 overflow-x-auto px-1.5 py-1.5"
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

        {/* File picker button */}
        {onFilePicker && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onFilePicker();
            }}
            className="press focus-ring text-muted-foreground hover:text-foreground relative flex h-11 min-w-[3.25rem] shrink-0 items-center justify-center rounded-lg px-2 transition-colors duration-200 hover:bg-[var(--fill-3)]"
          >
            <Paperclip className="h-4 w-4" />
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
            const key = shiftActive ? "\n" : "\r";
            startKeyRepeat(key, e.pointerId, e.clientX, e.clientY, () =>
              setShiftActive(false)
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
            onKeyPress(shiftActive ? "\n" : "\r");
            setShiftActive(false);
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
              startKeyRepeat(btn.key, e.pointerId, e.clientX, e.clientY);
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
              onKeyPress(btn.key);
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
