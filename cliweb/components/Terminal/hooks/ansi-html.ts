"use client";

/**
 * One line of `tmux capture-pane -e` output as HTML, coloured with the
 * terminal's own palette variables. tmux re-states attributes at the start
 * of every line, so each line is converted on its own.
 */

interface Style {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strike: boolean;
}

const plain = (): Style => ({
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strike: false,
});

const CUBE = [0, 95, 135, 175, 215, 255];

// The live terminal's own palette (published by the engine adapter), with
// the theme palette as fallback.
function color256(n: number): string {
  return `var(--term-core-color-${n}, ${fallbackColor(n)})`;
}

function fallbackColor(n: number): string {
  if (n < 16) return `var(--term-color-${n})`;
  if (n < 232) {
    const i = n - 16;
    return `rgb(${CUBE[Math.floor(i / 36)]},${CUBE[Math.floor(i / 6) % 6]},${CUBE[i % 6]})`;
  }
  const level = 8 + (n - 232) * 10;
  return `rgb(${level},${level},${level})`;
}

function applySgr(style: Style, params: number[]) {
  for (let i = 0; i < params.length; i += 1) {
    const p = params[i];
    if (p === 0) Object.assign(style, plain());
    else if (p === 1) style.bold = true;
    else if (p === 2) style.dim = true;
    else if (p === 3) style.italic = true;
    else if (p === 4) style.underline = true;
    else if (p === 7) style.inverse = true;
    else if (p === 9) style.strike = true;
    else if (p === 22) style.bold = style.dim = false;
    else if (p === 23) style.italic = false;
    else if (p === 24) style.underline = false;
    else if (p === 27) style.inverse = false;
    else if (p === 29) style.strike = false;
    else if (p >= 30 && p <= 37) style.fg = color256(p - 30);
    else if (p === 39) style.fg = null;
    else if (p >= 40 && p <= 47) style.bg = color256(p - 40);
    else if (p === 49) style.bg = null;
    else if (p >= 90 && p <= 97) style.fg = color256(p - 90 + 8);
    else if (p >= 100 && p <= 107) style.bg = color256(p - 100 + 8);
    else if (p === 38 || p === 48) {
      let value: string | null = null;
      if (params[i + 1] === 5 && i + 2 < params.length) {
        value = color256(params[i + 2] & 255);
        i += 2;
      } else if (params[i + 1] === 2 && i + 4 < params.length) {
        value = `rgb(${params[i + 2] & 255},${params[i + 3] & 255},${params[i + 4] & 255})`;
        i += 4;
      }
      if (value) {
        if (p === 38) style.fg = value;
        else style.bg = value;
      }
    }
  }
}

function css(style: Style): string {
  let fg = style.fg;
  let bg = style.bg;
  if (style.inverse) {
    fg = style.bg ?? "var(--term-bg)";
    bg = style.fg ?? "var(--term-fg)";
  }
  const parts: string[] = [];
  if (fg) parts.push(`color:${fg}`);
  if (bg) parts.push(`background:${bg}`);
  if (style.bold) parts.push("font-weight:bold");
  if (style.dim) parts.push("opacity:.6");
  if (style.italic) parts.push("font-style:italic");
  const lines = [style.underline && "underline", style.strike && "line-through"]
    .filter(Boolean)
    .join(" ");
  if (lines) parts.push(`text-decoration:${lines}`);
  return parts.join(";");
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function ansiLineToHtml(line: string): string {
  const style = plain();
  let html = "";
  let text = "";
  const flush = () => {
    if (!text) return;
    const attrs = css(style);
    html += attrs
      ? `<span style="${attrs}">${escapeHtml(text)}</span>`
      : escapeHtml(text);
    text = "";
  };
  // CSI sequences: SGR is applied, anything else is dropped.
  const pattern =
    /\x1b\[([0-9;:]*)([A-Za-z])|\x1b[^[]|[\x00-\x08\x0b-\x1f\x7f]/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    text += line.slice(last, match.index);
    last = (match.index ?? 0) + match[0].length;
    if (match[2] === "m") {
      flush();
      const params = (match[1] || "0")
        .split(/[;:]/)
        .map((value) => (value === "" ? 0 : Number(value)));
      applySgr(style, params);
    }
  }
  text += line.slice(last);
  flush();
  return html;
}
