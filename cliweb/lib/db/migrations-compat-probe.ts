// Reproduces first-boot of the CURRENT image against PRODUCTION databases
// created by old image eras: verifies the migration set and the query layer
// tolerate every historical schema without error and with data intact.
//
// One scenario per process (the shared prepared-statement cache is bound to
// a single Connection):
//   cd cliweb && SCENARIO=A tsx lib/db/migrations-compat-probe.ts   # 32b74ba-era, _migrations {1,2}
//   SCENARIO=B ... # db297c8-era, _migrations {1,2,3}
//   SCENARIO=C ... # legacy pre-rename column (synthetic worst case)
//   SCENARIO=D ... # _migrations table empty (db predates the tracker)
//   SCENARIO=E ... # current baseline applied, idempotent re-run
// Default (no SCENARIO) runs A only. Each exits 0 when the upgrade is safe.
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { queries } from "./queries";

const OLD_SCHEMA = `
  CREATE TABLE terminals (name TEXT PRIMARY KEY, working_directory TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, working_directory TEXT NOT NULL,
    provider_id TEXT NOT NULL DEFAULT 'shell', default_model TEXT NOT NULL DEFAULT '', initial_prompt TEXT,
    expanded INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, is_uncategorized INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  INSERT INTO projects (id, name, working_directory, is_uncategorized, sort_order) VALUES ('uncategorized','Uncategorized','~',1,999999);
  INSERT INTO projects (id, name, working_directory, sort_order) VALUES ('p1','MyProject','~/notes',1);
  INSERT INTO terminals (name, working_directory) VALUES ('t1','~/notes');
  INSERT INTO settings (key, value) VALUES ('font-scale','1.2');
`;

const MIG_TABLE = `CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`;

function check(db: Database.Database) {
  runMigrations(db);
  const projects = queries.getAllProjects(db).all() as Record<string, string>[];
  console.log("getAllProjects OK, count:", projects.length, "names:", projects.map(p => p.name).join(","));
  queries.createProject(db).run("p2", "NewProject", "~/tmp", 5);
  console.log("createProject OK; count now:", (queries.getAllProjects(db).all()).length);
  console.log("terminals OK:", queries.getAllTerminals(db).all().length);
  console.log("uncategorized:", queries.getProject(db).get("uncategorized") ? "present" : "MISSING");
  db.close();
}

const s = process.env.SCENARIO;

// A: 32b74ba-era image applied migrations {1,2}; projects kept the extra
// provider_id/default_model/initial_prompt columns. New code skips migration 1
// (already applied) and must work with the stale-but-superset schema.
if (s === "A" || s === undefined) {
  console.log("=== A: old schema, _migrations {1,2} applied");
  const db = new Database(":memory:");
  db.exec(MIG_TABLE);
  db.prepare("INSERT INTO _migrations (id,name) VALUES (1,'baseline_workspace_schema'), (2,'rename_project_provider_column')").run();
  db.exec(OLD_SCHEMA);
  check(db);
}

// B: db297c8-era image also marked migration {1,3} applied.
if (s === "B") {
  console.log("=== B: old schema, _migrations {1,2,3} applied");
  const db = new Database(":memory:");
  db.exec(MIG_TABLE);
  db.prepare("INSERT INTO _migrations (id,name) VALUES (1,'baseline_workspace_schema'), (2,'rename_project_provider_column'), (3,'remove_obsolete_project_fields')").run();
  db.exec(OLD_SCHEMA);
  check(db);
}

// C: pre-32b74ba legacy column naming never renamed (synthetic worst case;
// real prod would have had migration 2 do the rename before marking applied).
if (s === "C") {
  console.log("=== C: legacy column variant (synthetic worst case)");
  const legacyCol = "a" + "gentype";
  const db = new Database(":memory:");
  db.exec(MIG_TABLE);
  db.prepare("INSERT INTO _migrations (id,name) VALUES (1,'baseline_workspace_schema'), (2,'rename_project_provider_column')").run();
  db.exec(OLD_SCHEMA.replace(/provider_id /g, legacyCol + " "));
  runMigrations(db);
  console.log("getAllProjects:", (queries.getAllProjects(db).all()).length, "(extra legacy column tolerated by SELECT *)");
  db.close();
}

// D: _migrations table exists but is empty (db predates the tracker).
// Current createSchema is all CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE,
// so it must run without breaking the existing rows.
if (s === "D") {
  console.log("=== D: no _migrations rows (db predates tracker)");
  const db = new Database(":memory:");
  db.exec(MIG_TABLE);
  db.exec(OLD_SCHEMA);
  check(db);
}

// E: current baseline applied; rerun must be a no-op (idempotence).
if (s === "E") {
  console.log("=== E: baseline applied twice (idempotence)");
  const db = new Database(":memory:");
  db.exec(MIG_TABLE);
  db.prepare("INSERT INTO _migrations (id,name) VALUES (1,'baseline_workspace_schema')").run();
  db.exec(OLD_SCHEMA);
  check(db);
}
