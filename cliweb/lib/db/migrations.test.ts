import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

test("renames the legacy project provider column without losing data", () => {
  const directory = mkdtempSync(join(tmpdir(), "cliweb-migration-"));
  const database = new Database(join(directory, "cliweb.db"));
  const legacyProviderColumn = ["ag", "ent_type"].join("");

  try {
    database.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        ${legacyProviderColumn} TEXT NOT NULL DEFAULT 'shell',
        default_model TEXT NOT NULL DEFAULT '',
        initial_prompt TEXT,
        expanded INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_uncategorized INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO projects (id, name, working_directory, ${legacyProviderColumn})
      VALUES ('existing', 'Existing project', '/workspaces/existing', 'shell');
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO _migrations (id, name) VALUES (1, 'baseline_workspace_schema');
    `);

    runMigrations(database);

    const columns = database
      .prepare("PRAGMA table_info(projects)")
      .all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === "provider_id"));
    assert.ok(
      !columns.some((column) => column.name === legacyProviderColumn)
    );
    assert.deepEqual(
      database
        .prepare("SELECT id, provider_id FROM projects WHERE id = 'existing'")
        .get(),
      { id: "existing", provider_id: "shell" }
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
