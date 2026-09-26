"use client";

/**
 * Browser side of the native scroll bridge (lib/native-scroll.ts).
 *
 * TUIs such as jcode report their scrollable panes (exact rows, columns and
 * scroll position) and accept exact row deltas. Touch panning uses that in
 * place of guessing from redraws: only the pane's rows move, one row per row
 * of finger travel, stopping exactly at either end.
 */

export type NativePaneKind = "chat" | "side_panel";

export interface NativePane {
  kind: NativePaneKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rows scrolled down from the top (oldest) of the content. */
  position: number;
  content_length: number;
  viewport_length: number;
}

/**
 * One pane, as touch panning sees it. Rows are counted towards older output
 * (the direction a finger moving down scrolls), from the position at mark().
 */
export interface NativeScrollTarget {
  /** Screen rows and columns the pane's content occupies, inclusive. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Remember the app's current position; later counts start here. */
  mark(): void;
  /** Rows the app says it has moved since mark(); null once it is gone. */
  moved(): number | null;
  /** Rows that exist beyond the marked position, each way. */
  limits(): { older: number; newer: number } | null;
  /** Ask the app to move `lines` rows (positive = towards older rows). */
  scroll(lines: number): void;
}

export interface NativePanes {
  /** Where scroll requests go (the terminal's connection). */
  setSender(send: (pane: NativePaneKind, delta: number) => void): void;
  update(panes: NativePane[]): void;
  /**
   * The pane under a screen cell. Outside every pane (an app's header or
   * input box) this is the chat pane, which is what a swipe there means;
   * null only when no app reports panes.
   */
  paneAt(row: number, col: number): NativeScrollTarget | null;
}

export function createNativePanes(): NativePanes {
  let send: (pane: NativePaneKind, delta: number) => void = () => {};
  let panes: NativePane[] = [];
  const find = (kind: NativePaneKind) => panes.find((p) => p.kind === kind);

  return {
    setSender(next) {
      send = next;
    },

    update(next) {
      panes = next;
    },

    paneAt(row, col) {
      const pane =
        panes.find(
          (p) =>
            row >= p.y &&
            row < p.y + p.height &&
            col >= p.x &&
            col < p.x + p.width
        ) ?? panes.find((p) => p.kind === "chat");
      if (!pane || pane.height === 0 || pane.width === 0) return null;
      const kind = pane.kind;
      let marked = pane.position;
      return {
        top: pane.y,
        bottom: pane.y + pane.height - 1,
        left: pane.x,
        right: pane.x + pane.width - 1,
        mark() {
          marked = find(kind)?.position ?? marked;
        },
        moved() {
          const current = find(kind);
          return current ? marked - current.position : null;
        },
        limits() {
          const current = find(kind);
          if (!current) return null;
          const max = Math.max(
            0,
            current.content_length - current.viewport_length
          );
          return { older: marked, newer: Math.max(0, max - marked) };
        },
        scroll(lines) {
          if (lines === 0 || !find(kind)) return;
          // The app counts positive deltas towards newer output.
          send(kind, -lines);
        },
      };
    },
  };
}
