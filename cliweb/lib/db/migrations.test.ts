import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

test("creates the current database from one baseline migration", () => {
  const directory = mkdtempSync(join(tmpdir(), "cliweb-migration-"));
  const database = new Database(join(directory, "cliweb.db"));

  try {
    runMigrations(database);

    const projectColumns = database
      .prepare("PRAGMA table_info(projects)")
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      projectColumns.map((column) => column.name),
      [
        "id",
        "name",
        "working_directory",
        "expanded",
        "sort_order",
        "is_uncategorized",
        "created_at",
        "updated_at",
      ]
    );

    assert.deepEqual(
      database.prepare("SELECT id, name FROM _migrations ORDER BY id").all(),
      [{ id: 1, name: "baseline_workspace_schema" }]
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
