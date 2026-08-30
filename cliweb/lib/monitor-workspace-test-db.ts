import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * This module MUST be imported first by the persistence tests. lib/db captures
 * `process.env.DB_PATH` at evaluation time, so the temp path has to be assigned
 * before that module (or the API route that imports it) is loaded.
 */
export const MONITOR_WORKSPACE_TEST_DB_DIRECTORY = mkdtempSync(
  join(tmpdir(), "cliweb-monitor-")
);
process.env.DB_PATH = join(MONITOR_WORKSPACE_TEST_DB_DIRECTORY, "cliweb.db");
