import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { runMigrations } from "./migrations";
import { cliwebProfileSuffix } from "../runtime-environment";

// Re-export types and queries
export * from "./types";
export { queries } from "./queries";

// Default DB location: under the persistent CLIWeb home. With CLIWEB_PROFILE
// set (e.g. "test"), data lives in ~/.cliweb-<profile>/ so production and
// test deployments never share data. Explicit DB_PATH always wins.
const DB_PATH =
  process.env.DB_PATH ||
  path.join(
    process.env.HOME || process.cwd(),
    `.cliweb${cliwebProfileSuffix()}`,
    "cliweb.db"
  );
const LOCK_PATH = DB_PATH + ".init-lock";

// Simple file-based lock for initialization
function withInitLock<T>(fn: () => T): T {
  const maxWait = 10000; // 10 seconds
  const start = Date.now();

  // Wait for lock to be available
  while (fs.existsSync(LOCK_PATH)) {
    if (Date.now() - start > maxWait) {
      // Stale lock, remove it
      try {
        fs.unlinkSync(LOCK_PATH);
      } catch {}
      break;
    }
    // Busy wait (sync is fine here, this is initialization)
    const waitUntil = Date.now() + 100;
    while (Date.now() < waitUntil) {}
  }

  // Acquire lock
  try {
    fs.writeFileSync(LOCK_PATH, String(process.pid));
  } catch {
    // Another process got it first, wait and retry
    return withInitLock(fn);
  }

  try {
    return fn();
  } finally {
    // Release lock
    try {
      fs.unlinkSync(LOCK_PATH);
    } catch {}
  }
}

// Initialize database with schema
function initDb(): Database.Database {
  return withInitLock(() => {
    // better-sqlite3 does not create missing parent directories. This
    // matters for non-default profiles (CLIWEB_PROFILE=test -> ~/.cliweb-test),
    // which the container entrypoint does not pre-create.
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH, { timeout: 10000 });

    // Enable WAL mode for better concurrency
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 10000");

    // Apply the single baseline schema migration.
    runMigrations(db);

    return db;
  });
}

// Singleton database instance
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = initDb();
  }
  return _db;
}

// Lazy getter - don't initialize on import
export const db = new Proxy({} as Database.Database, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
