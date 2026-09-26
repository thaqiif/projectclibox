import type Database from "better-sqlite3";

// Prepared statement cache
const stmtCache = new Map<string, Database.Statement>();

function getStmt(db: Database.Database, sql: string): Database.Statement {
  const key = sql;
  let stmt = stmtCache.get(key);
  if (!stmt) {
    stmt = db.prepare(sql);
    stmtCache.set(key, stmt);
  }
  return stmt;
}

export const queries = {
  // Terminals registry
  rememberTerminal: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO terminals (name, working_directory)
       VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET
         working_directory = excluded.working_directory,
         last_seen_at = datetime('now')`
    ),

  touchTerminal: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE terminals SET last_seen_at = datetime('now') WHERE name = ?`
    ),

  getAllTerminals: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM terminals ORDER BY created_at ASC`),

  forgetTerminal: (db: Database.Database) =>
    getStmt(db, `DELETE FROM terminals WHERE name = ?`),

  renameTerminalRow: (db: Database.Database) =>
    getStmt(db, `UPDATE terminals SET name = ? WHERE name = ?`),

  // Projects
  createProject: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO projects (id, name, working_directory, sort_order)
       VALUES (?, ?, ?, ?)`
    ),

  getProject: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM projects WHERE id = ?`),

  getAllProjects: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM projects ORDER BY is_uncategorized ASC, sort_order ASC, name ASC`
    ),

  updateProject: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE projects SET name = ?, working_directory = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateProjectExpanded: (db: Database.Database) =>
    getStmt(db, `UPDATE projects SET expanded = ? WHERE id = ?`),

  updateProjectOrder: (db: Database.Database) =>
    getStmt(db, `UPDATE projects SET sort_order = ? WHERE id = ?`),

  deleteProject: (db: Database.Database) =>
    getStmt(db, `DELETE FROM projects WHERE id = ? AND is_uncategorized = 0`),

  // Settings
  getSetting: (db: Database.Database) =>
    getStmt(db, `SELECT value FROM settings WHERE key = ?`),

  setSetting: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ),

  getAllSettings: (db: Database.Database) =>
    getStmt(db, `SELECT key, value FROM settings`),
};
