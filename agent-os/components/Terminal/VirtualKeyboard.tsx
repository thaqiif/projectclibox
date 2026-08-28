"use client";

import { useState, useCallback, useRef, useEffect, memo } from "react";
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Mic,
  MicOff,
  Clipboard,
  X,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useKeyRepeat } from "@/hooks/useKeyRepeat";

// ANSI escape sequences
const SPECIAL_KEYS = {
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  LEFT: "\x1b[D",
  RIGHT: "\x1b[C",
  ENTER: "\r",
  ESC: "\x1b",
  TAB: "\t",
  BACKSPACE: "\x7f",
  CTRL_C: "\x03",
  CTRL_D: "\x04",
  CTRL_Z: "\x1a",
  CTRL_L: "\x0c",
} as const;

// Keyboard layouts
const ROWS = {
  numbers: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  numbersShift: ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"],
  row1: ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  row2: ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  row3: ["z", "x", "c", "v", "b", "n", "m"],
  symbols: ["-", "/", ":", ";", "(", ")", "$", "&", "@", '"'],
  symbolsMore: [".", ",", "?", "!", "'", "`", "~", "=", "+", "*"],
};

type KeyboardMode = "quick" | "abc" | "num";

interface VirtualKeyboardProps {
  onKeyPress: (key: string) => void;
  onImagePick?: () => void;
  visible?: boolean;
}

// Track last touch time globally to prevent duplicate events from touch->mouse emulation
let lastTouchTime = 0;

// Event delegation handler - finds the key from data attribute and fires callback
function createKeyboardHandler(onKey: (key: string) => void) {
  const handleEvent = (e: TouchEvent | MouseEvent) => {
    // Find the button with data-key attribute
    const target = e.target as HTMLElement;
    const button = target.closest("[data-key]") as HTMLElement | null;
    if (!button) return;

    const key = button.getAttribute("data-key");
    if (!key) return;

    e.preventDefault();

    // Prevent duplicate from touch->mouse emulation
    if (e.type === "touchstart") {
      lastTouchTime = Date.now();
    } else if (e.type === "mousedown" && Date.now() - lastTouchTime < 500) {
      return;
    }

    onKey(key);
  };

  return handleEvent;
}

// Simple key button - no individual handlers, uses event delegation
// Memoized to prevent re-renders when parent state changes (like shift)
const Key = memo(function Key({
  char,
  dataKey,
  className,
}: {
  char: string;
  dataKey?: string;
  className?: string;
}) {
  return (
    <button
      data-key={dataKey ?? char}
      className={cn(
        "bg-surface-raised text-foreground flex h-[44px] flex-1 touch-manipulation items-center justify-center rounded-lg text-[0.8125rem] font-medium shadow-[var(--elev-1)] active:scale-95 active:bg-[var(--fill-2)]",
        "min-w-[32px] select-none",
        className
      )}
    >
      {char}
    </button>
  );
});

// Fast button for special keys (uses event delegation via data-key)
function FastKey({
  dataKey,
  className,
  children,
}: {
  dataKey: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button data-key={dataKey} className={className}>
      {children}
    </button>
  );
}

// Fast button with direct handler (for shortcuts bar which is outside main keyboard delegation)
function FastButton({
  onPress,
  className,
  children,
}: {
  onPress: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    lastTouchTime = Date.now();
    onPress();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (Date.now() - lastTouchTime < 500) return;
    e.preventDefault();
    onPress();
  };

  return (
    <button
      onTouchStart={handleTouchStart}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => e.preventDefault()}
      className={className}
    >
      {children}
    </button>
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus input when modal opens
  useCallback(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

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
      className="animate-in fade-in-0 fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[3px] duration-200"
      onClick={onClose}
    >
      <div
        className="glass-thick glass-float animate-in slide-in-from-bottom w-full max-w-lg rounded-t-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
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
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            // Handle paste event directly
            const pasted = e.clipboardData?.getData("text");
            if (pasted) {
              e.preventDefault();
              setText((prev) => prev + pasted);
            }
          }}
          placeholder="Tap here, then long-press to paste..."
          autoFocus
          inputMode="text"
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

// Terminal shortcuts bar - common keys for terminal interaction
function TerminalShortcutsBar({
  onKeyPress,
  isListening,
  onMicToggle,
  isMicSupported,
}: {
  onKeyPress: (key: string) => void;
  isListening?: boolean;
  onMicToggle?: () => void;
  isMicSupported?: boolean;
}) {
  const [showPasteModal, setShowPasteModal] = useState(false);

  const shortcuts = [
    { label: "Esc", key: SPECIAL_KEYS.ESC },
    { label: "^C", key: SPECIAL_KEYS.CTRL_C, highlight: true },
    { label: "Tab", key: SPECIAL_KEYS.TAB },
    { label: "^D", key: SPECIAL_KEYS.CTRL_D },
    { label: "^Z", key: SPECIAL_KEYS.CTRL_Z },
    { label: "^L", key: SPECIAL_KEYS.CTRL_L },
    { label: "↑", key: SPECIAL_KEYS.UP },
    { label: "↓", key: SPECIAL_KEYS.DOWN },
  ];

  // Handle paste - try clipboard API first, fall back to modal
  const handlePaste = useCallback(async () => {
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          for (const char of text) {
            onKeyPress(char);
          }
          return;
        }
      }
    } catch {
      // Clipboard API failed, show modal
    }
    // Fall back to modal
    setShowPasteModal(true);
  }, [onKeyPress]);

  // Handle paste from modal
  const handleModalPaste = useCallback(
    (text: string) => {
      for (const char of text) {
        onKeyPress(char);
      }
    },
    [onKeyPress]
  );

  return (
    <>
      <PasteModal
        open={showPasteModal}
        onClose={() => setShowPasteModal(false)}
        onPaste={handleModalPaste}
      />
      <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto px-2 pt-2 pb-1">
        {/* Paste button */}
        <FastButton
          onPress={handlePaste}
          className="bg-surface-raised text-muted-foreground active:text-foreground flex-shrink-0 touch-manipulation rounded-full rounded-lg px-3 py-1.5 text-[0.75rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
        >
          <Clipboard className="h-3.5 w-3.5" />
        </FastButton>
        {/* Mic button - always visible when supported */}
        {isMicSupported && onMicToggle && (
          <FastButton
            onPress={onMicToggle}
            className={cn(
              "bg-surface-raised flex-shrink-0 touch-manipulation rounded-full rounded-lg px-3 py-1.5 text-[0.75rem] font-medium shadow-[var(--elev-1)] select-none",
              isListening
                ? "text-destructive animate-pulse"
                : "text-muted-foreground active:text-foreground active:scale-95 active:bg-[var(--fill-2)]"
            )}
          >
            {isListening ? (
              <MicOff className="h-3.5 w-3.5" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
          </FastButton>
        )}
        {shortcuts.map((shortcut) => (
          <FastButton
            key={shortcut.label}
            onPress={() => onKeyPress(shortcut.key)}
            className={cn(
              "bg-surface-raised active:text-foreground flex-shrink-0 touch-manipulation rounded-full rounded-lg px-3 py-1.5 text-[0.75rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]",
              shortcut.highlight ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {shortcut.label}
          </FastButton>
        ))}
      </div>
    </>
  );
}

export function VirtualKeyboard({
  onKeyPress,
  onImagePick,
  visible = true,
}: VirtualKeyboardProps) {
  const [mode, setMode] = useState<KeyboardMode>("abc");
  const [shifted, setShifted] = useState(false);
  const keyboardRef = useRef<HTMLDivElement>(null);

  // Speech recognition - send transcript directly to terminal
  const handleTranscript = useCallback(
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
  } = useSpeechRecognition(handleTranscript);

  // Key repeat for backspace
  const handleBackspace = useCallback(() => {
    onKeyPress(SPECIAL_KEYS.BACKSPACE);
  }, [onKeyPress]);
  const { startRepeat: startBackspace, stopRepeat: stopBackspace } =
    useKeyRepeat(handleBackspace);

  // Event delegation - attach once, handle all keys
  useEffect(() => {
    const el = keyboardRef.current;
    if (!el) return;

    const handleKey = (key: string) => {
      // Handle special keys
      if (key === "SHIFT") {
        setShifted((s) => !s);
        return;
      }
      if (key === "MODE_ABC") {
        setMode("abc");
        return;
      }
      if (key === "MODE_NUM") {
        setMode("num");
        return;
      }
      if (key === "MODE_QUICK") {
        setMode("quick");
        return;
      }
      if (key === "SPACE") {
        onKeyPress(" ");
        return;
      }
      if (key === "ENTER") {
        onKeyPress(SPECIAL_KEYS.ENTER);
        return;
      }
      if (key === "LEFT") {
        onKeyPress(SPECIAL_KEYS.LEFT);
        return;
      }
      if (key === "RIGHT") {
        onKeyPress(SPECIAL_KEYS.RIGHT);
        return;
      }
      if (key === "UP") {
        onKeyPress(SPECIAL_KEYS.UP);
        return;
      }
      if (key === "DOWN") {
        onKeyPress(SPECIAL_KEYS.DOWN);
        return;
      }
      if (key === "IMAGE" && onImagePick) {
        onImagePick();
        return;
      }

      // Regular character - apply shift if needed
      const char = shifted ? key.toUpperCase() : key;
      onKeyPress(char);
      if (shifted) setShifted(false);
    };

    const handler = createKeyboardHandler(handleKey);

    el.addEventListener("touchstart", handler, { passive: false });
    el.addEventListener("mousedown", handler);
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    return () => {
      el.removeEventListener("touchstart", handler);
      el.removeEventListener("mousedown", handler);
    };
  }, [onKeyPress, shifted, onImagePick]);

  if (!visible) return null;

  // Quick mode - just essential terminal keys
  if (mode === "quick") {
    return (
      <div
        ref={keyboardRef}
        className="glass glass-edge-top relative z-10 flex flex-col select-none"
      >
        {/* Terminal shortcuts */}
        <TerminalShortcutsBar
          onKeyPress={onKeyPress}
          isListening={isListening}
          onMicToggle={toggleMic}
          isMicSupported={isMicSupported}
        />

        <div className="flex flex-col gap-1.5 px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {/* Mode tabs + common keys */}
          <div className="flex gap-1">
            <FastKey
              dataKey="MODE_ABC"
              className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] flex-1 touch-manipulation items-center justify-center rounded-lg text-[0.8125rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
            >
              ABC
            </FastKey>
            <FastKey
              dataKey="MODE_NUM"
              className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] flex-1 touch-manipulation items-center justify-center rounded-lg text-[0.8125rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
            >
              123
            </FastKey>
            {onImagePick && (
              <FastKey
                dataKey="IMAGE"
                className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] w-[44px] touch-manipulation items-center justify-center rounded-lg shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
              >
                <ImagePlus className="h-4 w-4" />
              </FastKey>
            )}
            <div className="flex-1" />
            <button
              onTouchStart={startBackspace}
              onTouchEnd={stopBackspace}
              onTouchCancel={stopBackspace}
              onMouseDown={startBackspace}
              onMouseUp={stopBackspace}
              onMouseLeave={stopBackspace}
              className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] w-[56px] touch-manipulation items-center justify-center rounded-lg text-[0.9375rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
            >
              ⌫
            </button>
          </div>

          {/* Arrow keys + Enter */}
          <div className="flex gap-1">
            <FastKey
              dataKey="LEFT"
              className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] w-[44px] touch-manipulation items-center justify-center rounded-lg shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </FastKey>
            <div className="flex flex-col gap-1">
              <FastKey
                dataKey="UP"
                className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[20px] w-[44px] touch-manipulation items-center justify-center rounded-lg shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
              >
                <ChevronUp className="h-3 w-3" />
              </FastKey>
              <FastKey
                dataKey="DOWN"
                className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[20px] w-[44px] touch-manipulation items-center justify-center rounded-lg shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
              >
                <ChevronDown className="h-3 w-3" />
              </FastKey>
            </div>
            <FastKey
              dataKey="RIGHT"
              className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] w-[44px] touch-manipulation items-center justify-center rounded-lg shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
            >
              <ChevronRight className="h-4 w-4" />
            </FastKey>
            <div className="flex-1" />
            <Key char="⏎" dataKey="ENTER" className="text-primary w-[68px]" />
          </div>
        </div>
      </div>
    );
  }

  // ABC mode - full QWERTY
  if (mode === "abc") {
    return (
      <div
        ref={keyboardRef}
        className="glass glass-edge-top relative z-10 flex flex-col select-none"
      >
        {/* Terminal shortcuts */}
        <TerminalShortcutsBar
          onKeyPress={onKeyPress}
          isListening={isListening}
          onMicToggle={toggleMic}
          isMicSupported={isMicSupported}
        />

        <div className="flex flex-col gap-1.5 px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {/* QWERTY rows */}
          <div className="flex gap-1">
            {ROWS.row1.map((char) => (
              <Key
                key={char}
                char={shifted ? char.toUpperCase() : char}
                dataKey={char}
              />
            ))}
          </div>
          <div className="flex gap-1 px-4">
            {ROWS.row2.map((char) => (
              <Key
                key={char}
                char={shifted ? char.toUpperCase() : char}
                dataKey={char}
              />
            ))}
          </div>
          <div className="flex gap-1">
            <FastKey
              dataKey="SHIFT"
              className={cn(
                "flex h-[44px] w-[48px] touch-manipulation items-center justify-center text-[0.9375rem] font-medium select-none",
                shifted
                  ? "bg-primary/16 text-primary active:text-foreground rounded-lg shadow-[var(--elev-1)] active:scale-95 active:bg-[var(--fill-2)]"
                  : "bg-surface-raised text-muted-foreground active:text-foreground rounded-lg shadow-[var(--elev-1)] active:scale-95 active:bg-[var(--fill-2)]"
              )}
            >
              ⇧
            </FastKey>
            {ROWS.row3.map((char) => (
              <Key
                key={char}
                char={shifted ? char.toUpperCase() : char}
                dataKey={char}
              />
            ))}
            <button
              onTouchStart={startBackspace}
              onTouchEnd={stopBackspace}
              onTouchCancel={stopBackspace}
              onMouseDown={startBackspace}
              onMouseUp={stopBackspace}
              onMouseLeave={stopBackspace}
              className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] w-[48px] touch-manipulation items-center justify-center rounded-lg text-[0.9375rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
            >
              ⌫
            </button>
          </div>

          {/* Bottom row */}
          <div className="flex gap-1">
            <FastKey
              dataKey="MODE_QUICK"
              className="bg-surface-raised text-destructive flex h-[44px] w-[56px] touch-manipulation items-center justify-center rounded-lg text-[0.8125rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
            >
              ^C
            </FastKey>
            <FastKey
              dataKey="MODE_NUM"
              className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] w-[48px] touch-manipulation items-center justify-center rounded-lg text-[0.8125rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
            >
              123
            </FastKey>
            <FastKey
              dataKey="SPACE"
              className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] flex-1 touch-manipulation items-center justify-center rounded-lg text-[0.8125rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
            >
              space
            </FastKey>
            <FastKey
              dataKey="ENTER"
              className="bg-primary/16 text-primary active:text-foreground flex h-[44px] w-[68px] touch-manipulation items-center justify-center rounded-lg text-[0.8125rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
            >
              ⏎
            </FastKey>
          </div>
        </div>
      </div>
    );
  }

  // Num mode - numbers and symbols
  return (
    <div
      ref={keyboardRef}
      className="glass glass-edge-top relative z-10 flex flex-col select-none"
    >
      {/* Terminal shortcuts */}
      <TerminalShortcutsBar
        onKeyPress={onKeyPress}
        isListening={isListening}
        onMicToggle={toggleMic}
        isMicSupported={isMicSupported}
      />

      <div className="flex flex-col gap-1.5 px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        {/* Number row */}
        <div className="flex gap-1">
          {ROWS.numbers.map((char) => (
            <Key key={char} char={char} />
          ))}
        </div>

        {/* Symbols rows */}
        <div className="flex gap-1">
          {ROWS.symbols.map((char) => (
            <Key key={char} char={char} />
          ))}
        </div>
        <div className="flex gap-1">
          {ROWS.symbolsMore.map((char) => (
            <Key key={char} char={char} />
          ))}
        </div>

        {/* Bottom row */}
        <div className="flex gap-1">
          <FastKey
            dataKey="MODE_QUICK"
            className="bg-surface-raised text-destructive flex h-[44px] w-[56px] touch-manipulation items-center justify-center rounded-lg text-[0.8125rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
          >
            ^C
          </FastKey>
          <FastKey
            dataKey="MODE_ABC"
            className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] w-[48px] touch-manipulation items-center justify-center rounded-lg text-[0.8125rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
          >
            ABC
          </FastKey>
          <FastKey
            dataKey="SPACE"
            className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] flex-1 touch-manipulation items-center justify-center rounded-lg text-[0.8125rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
          >
            space
          </FastKey>
          <button
            onTouchStart={startBackspace}
            onTouchEnd={stopBackspace}
            onTouchCancel={stopBackspace}
            onMouseDown={startBackspace}
            onMouseUp={stopBackspace}
            onMouseLeave={stopBackspace}
            className="bg-surface-raised text-muted-foreground active:text-foreground flex h-[44px] w-[48px] touch-manipulation items-center justify-center rounded-lg text-[0.9375rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
          >
            ⌫
          </button>
          <FastKey
            dataKey="ENTER"
            className="bg-primary/16 text-primary active:text-foreground flex h-[44px] w-[68px] touch-manipulation items-center justify-center rounded-lg text-[0.8125rem] font-medium shadow-[var(--elev-1)] select-none active:scale-95 active:bg-[var(--fill-2)]"
          >
            ⏎
          </FastKey>
        </div>
      </div>
    </div>
  );
}
