import type Database from "better-sqlite3";
import { createSchema } from "./schema";

interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

function removeObsoleteProjectFields(db: Database.Database): void {
  const retainedColumns = [
    "id",
    "name",
    "working_directory",
    "expanded",
    "sort_order",
    "is_uncategorized",
    "created_at",
    "updated_at",
  ];
  const columns = (
    db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>
  ).map((column) => column.name);

  if (
    columns.length === retainedColumns.length &&
    columns.every((column, index) => column === retainedColumns[index])
  ) {
    return;
  }

  db.transaction(() => {
    db.exec(`
      CREATE TABLE projects_current (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        expanded INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_uncategorized INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO projects_current (
        id,
        name,
        working_directory,
        expanded,
        sort_order,
        is_uncategorized,
        created_at,
        updated_at
      )
      SELECT
        id,
        name,
        working_directory,
        expanded,
        sort_order,
        is_uncategorized,
        created_at,
        updated_at
      FROM projects;
      DROP TABLE projects;
      ALTER TABLE projects_current RENAME TO projects;
    `);
  })();
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
    id: 3,
    name: "remove_obsolete_project_fields",
    up: removeObsoleteProjectFields,
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
