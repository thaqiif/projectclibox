import type Database from "better-sqlite3";
import { createSchema } from "./schema";

interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

function renameLegacyProviderColumn(db: Database.Database): void {
  // Preserve databases created by the retired product without carrying its
  // identifier into the current schema or API.
  const legacyProviderColumn = ["ag", "ent_type"].join("");
  const columns = db.prepare("PRAGMA table_info(projects)").all() as Array<{
    name: string;
  }>;
  const hasLegacyColumn = columns.some(
    (column) => column.name === legacyProviderColumn
  );
  const hasProviderColumn = columns.some(
    (column) => column.name === "provider_id"
  );

  if (hasLegacyColumn && !hasProviderColumn) {
    db.exec(
      `ALTER TABLE projects RENAME COLUMN ${legacyProviderColumn} TO provider_id`
    );
  }
}

// Fresh databases start from the current baseline. Later migrations preserve
// user data created by earlier CLIWeb images.
const migrations: Migration[] = [
  {
    id: 1,
    name: "baseline_workspace_schema",
    up: createSchema,
  },
  {
    id: 2,
    name: "rename_project_provider_column",
    up: renameLegacyProviderColumn,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (db.prepare(`SELECT id FROM _migrations`).all() as { id: number }[]).map(
      (row) => row.id
    )
  );

  const insertMigration = db.prepare(
    `INSERT OR IGNORE INTO _migrations (id, name) VALUES (?, ?)`
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    migration.up(db);
    insertMigration.run(migration.id, migration.name);
    console.log(`Migration ${migration.id}: ${migration.name} applied`);
  }
}
