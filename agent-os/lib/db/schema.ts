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

    -- Dev servers table
    CREATE TABLE IF NOT EXISTS dev_servers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'node',
      name TEXT NOT NULL DEFAULT '',
      command TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      container_id TEXT,
      ports TEXT NOT NULL DEFAULT '[]',
      working_directory TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Projects table (replaces groups)
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      agent_type TEXT NOT NULL DEFAULT 'shell',
      default_model TEXT NOT NULL DEFAULT '',
      initial_prompt TEXT,
      expanded INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_uncategorized INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Project dev servers (configuration templates)
    CREATE TABLE IF NOT EXISTS project_dev_servers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'node',
      command TEXT NOT NULL,
      port INTEGER,
      port_env_var TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Project repositories (for multi-repo git support)
    CREATE TABLE IF NOT EXISTS project_repositories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- App settings (key/value): font scale and font family.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_project_dev_servers_project ON project_dev_servers(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_repositories_project ON project_repositories(project_id);

    -- Default Uncategorized project
    INSERT OR IGNORE INTO projects (id, name, working_directory, is_uncategorized, sort_order)
    VALUES ('uncategorized', 'Uncategorized', '~', 1, 999999);
  `);
}
