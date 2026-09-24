import { mediaKindFor } from "./media-mime";

export interface SaveableFileState {
  path?: string;
  isBinary: boolean;
  truncated: boolean;
}

export const NON_EDITABLE_SAVE_ERROR =
  "This file is binary or too large to edit and cannot be saved. Use download instead.";

/** Return a user-facing refusal when the editor never loaded editable bytes. */
export function saveRefusalFor(file: SaveableFileState): string | null {
  return file.isBinary || file.truncated || mediaKindFor(file.path) !== null
    ? NON_EDITABLE_SAVE_ERROR
    : null;
}
