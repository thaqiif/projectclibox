import { mediaKindFor } from "./media-mime";

export interface SaveableFileState {
  path?: string;
  isBinary: boolean;
  truncated: boolean;
}

export const NON_EDITABLE_SAVE_ERROR =
  "This file cannot be edited or saved here (binary, too large, or media). Use download instead.";

/**
 * Return a user-facing refusal when this file must not be written from the
 * editor: binary and truncated files only ever held a placeholder, and media
 * is viewer-only (the viewer replaces the editor, so any stale media state is
 * refused too). Every save entry point funnels through here.
 */
export function saveRefusalFor(file: SaveableFileState): string | null {
  return file.isBinary || file.truncated || mediaKindFor(file.path) !== null
    ? NON_EDITABLE_SAVE_ERROR
    : null;
}
