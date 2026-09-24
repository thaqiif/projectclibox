/**
 * Test harness for upload-temp-func.test.ts: isolates HOME before the
 * upload-temp route module loads (same pattern as ops-test-env.ts).
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

export const UPLOAD_TMP_ROOT = mkdtempSync(`${tmpdir()}/upload-temp-test-`);
process.env.HOME = UPLOAD_TMP_ROOT;
