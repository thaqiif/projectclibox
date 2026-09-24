export interface SaveableFileState {
  isBinary: boolean;
  truncated: boolean;
}

export const NON_EDITABLE_SAVE_ERROR =
  "This file is binary or too large to edit and cannot be saved. Use download instead.";

/** Return a user-facing refusal when the editor never loaded editable bytes. */
export function saveRefusalFor(file: SaveableFileState): string | null {
  return file.isBinary || file.truncated ? NON_EDITABLE_SAVE_ERROR : null;
}
