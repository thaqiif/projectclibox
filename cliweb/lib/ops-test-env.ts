/**
 * Test harness for ops-route-func.test.ts: isolates HOME-derived paths
 * BEFORE the /api/files route modules are imported (they bind TRASH_DIR etc.
 * at module load time). Must be imported first, so its side effects run
 * before the route module initializers.
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

export const OPS_TMP_ROOT = mkdtempSync(`${tmpdir()}/ops-route-test-`);
process.env.HOME = OPS_TMP_ROOT;
