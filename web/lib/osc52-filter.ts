export const MAX_OSC52_BYTES = 16 * 1024 * 1024;
const MAX_OSC52_BASE64_CHARS = Math.ceil(MAX_OSC52_BYTES / 3) * 4 + 16;

export interface Osc52FilterResult {
  terminalData: string;
  clipboardText?: string;
}

function oscEnd(data: string, start: number): { index: number; length: number } | null {
  for (let index = start; index < data.length; index += 1) {
    if (data[index] === "\u0007") return { index, length: 1 };
    if (data[index] === "\u001b" && data[index + 1] === "\\") {
      return { index, length: 2 };
    }
  }
  return null;
}

function decodeOsc52(body: string): string | null {
  const firstSeparator = body.indexOf(";");
  const secondSeparator = body.indexOf(";", firstSeparator + 1);
  if (
    firstSeparator < 0 ||
    secondSeparator < 0 ||
    body.slice(0, firstSeparator) !== "52"
  ) {
    return null;
  }
  const payload = body.slice(secondSeparator + 1);
  if (!payload || payload === "?") return null;
  if (
    payload.length > MAX_OSC52_BASE64_CHARS ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      payload
    )
  ) {
    return null;
  }

  try {
    const binary = atob(payload);
    if (binary.length > MAX_OSC52_BYTES) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
}

/** Remove OSC 52 writes from terminal output and surface decoded text to UI. */
export class Osc52Filter {
  private carry = "";
  private discardingOversized = false;

  push(data: string): Osc52FilterResult {
    if (!this.carry && !this.discardingOversized && !data.includes("\u001b")) {
      return { terminalData: data };
    }

    let input = this.carry + data;
    this.carry = "";
    let clipboardText: string | undefined;
    let terminalData = "";
    let cursor = 0;

    if (this.discardingOversized) {
      const end = oscEnd(input, 0);
      if (!end) {
        this.carry = input.endsWith("\u001b") ? "\u001b" : "";
        return { terminalData: "" };
      }
      input = input.slice(end.index + end.length);
      this.discardingOversized = false;
    }

    while (cursor < input.length) {
      const start = input.indexOf("\u001b]", cursor);
      if (start < 0) {
        const tail = input.slice(cursor);
        if (tail.endsWith("\u001b")) {
          terminalData += tail.slice(0, -1);
          this.carry = "\u001b";
        } else {
          terminalData += tail;
        }
        break;
      }

      terminalData += input.slice(cursor, start);
      const contentStart = start + 2;
      const end = oscEnd(input, contentStart);
      if (!end) {
        const body = input.slice(contentStart);
        const possible52 = "52;".startsWith(body) || body.startsWith("52;");
        if (possible52 && body.length > MAX_OSC52_BASE64_CHARS + 256) {
          this.discardingOversized = true;
          break;
        }
        this.carry = input.slice(start);
        break;
      }

      const sequenceEnd = end.index + end.length;
      const body = input.slice(contentStart, end.index);
      if (body.startsWith("52;")) {
        const decoded = decodeOsc52(body);
        if (decoded !== null) clipboardText = decoded;
      } else {
        terminalData += input.slice(start, sequenceEnd);
      }
      cursor = sequenceEnd;
    }

    return clipboardText === undefined
      ? { terminalData }
      : { terminalData, clipboardText };
  }

  reset(): void {
    this.carry = "";
    this.discardingOversized = false;
  }
}
