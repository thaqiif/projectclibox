import type Database from "better-sqlite3";

export function createSchema(db: Database.Database): void {
  db.exec(`
    -- Terminals registry
    --
    -- tmux remains the source of truth for what is *running*. This table
    -- only remembers that a terminal exists and where it lives, so killing
    -- its tmux terminal leaves the entry in the sidebar to be restarted
    -- rather than making it vanish.
    CREATE TABLE IF NOT EXISTS terminals (
      name TEXT PRIMARY KEY,
      working_directory TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Projects table (replaces groups)
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      expanded INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_uncategorized INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- App settings (key/value): font scale and font family.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes for common queries
    -- Default Uncategorized project
    INSERT OR IGNORE INTO projects (id, name, working_directory, is_uncategorized, sort_order)
    VALUES ('uncategorized', 'Uncategorized', '~', 1, 999999);
  `);
}
