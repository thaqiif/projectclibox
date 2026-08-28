import type Database from "better-sqlite3";
import { createSchema } from "./schema";

interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

// This repository starts with a clean database. The complete schema is one
// baseline migration rather than a history of upstream migrations and no-op
// compatibility steps.
const migrations: Migration[] = [
  {
    id: 1,
    name: "baseline_workspace_schema",
    up: createSchema,
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
