export interface TerminalModifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

const SHIFT_SYMBOLS: Record<string, string> = {
  "`": "~",
  "1": "!",
  "2": "@",
  "3": "#",
  "4": "$",
  "5": "%",
  "6": "^",
  "7": "&",
  "8": "*",
  "9": "(",
  "0": ")",
  "-": "_",
  "=": "+",
  "[": "{",
  "]": "}",
  "\\": "|",
  ";": ":",
  "'": '"',
  ",": "<",
  ".": ">",
  "/": "?",
};

const ARROWS: Record<string, string> = {
  ArrowUp: "A",
  ArrowDown: "B",
  ArrowRight: "C",
  ArrowLeft: "D",
  Home: "H",
  End: "F",
};

/** Encode toolbar and virtual-modifier keys with xterm's CSI modifiers. */
export function terminalKeySequence(
  key: string,
  { shift, ctrl, alt }: TerminalModifiers
): string | null {
  const modifier = 1 + Number(shift) + 2 * Number(alt) + 4 * Number(ctrl);
  const arrow = ARROWS[key];
  if (arrow) {
    return modifier === 1 ? `\x1b[${arrow}` : `\x1b[1;${modifier}${arrow}`;
  }
  if (key === "ControlC") return "\x03";
  if (key === "Newline") return "\x1b\r";
  if (key === "ShiftTab") return "\x1b[Z";
  if (key === "Escape") return "\x1b";
  if (key === "Tab")
    return alt ? "\x1b" + (shift ? "\x1b[Z" : "\t") : shift ? "\x1b[Z" : "\t";
  if (key === "Enter") return (alt ? "\x1b" : "") + (shift ? "\n" : "\r");
  if (key === "Backspace")
    return (alt ? "\x1b" : "") + (shift ? "\x08" : "\x7f");
  if (key === "Delete")
    return modifier === 1 ? "\x1b[3~" : `\x1b[3;${modifier}~`;
  if (key === "PageUp" || key === "PageDown") {
    const number = key === "PageUp" ? 5 : 6;
    return modifier === 1 ? `\x1b[${number}~` : `\x1b[${number};${modifier}~`;
  }
  if (key.length !== 1) return null;
  const char = shift ? (SHIFT_SYMBOLS[key] ?? key.toUpperCase()) : key;
  let sequence = char;
  if (ctrl) {
    if (char === " ") sequence = "\x00";
    else if (char === "?") sequence = "\x7f";
    else {
      const code = char.toUpperCase().charCodeAt(0);
      if (code < 64 || code > 95) return null;
      sequence = String.fromCharCode(code & 0x1f);
    }
  }
  return alt ? "\x1b" + sequence : sequence;
}
