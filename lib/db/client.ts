import "server-only";

import Database from "better-sqlite3";
import { migrate } from "@/lib/db/migrate";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(process.env.DATABASE_PATH ?? "./data/portfolio.db");
  db.pragma("foreign_keys = ON");
  // Several of these connections exist in one process (Next compiles
  // instrumentation.ts, route handlers, and server actions into separate
  // webpack layers, each instantiating this module). Without a busy
  // timeout, a write from one connection while another holds SQLite's
  // write lock throws SQLITE_BUSY immediately instead of waiting briefly
  // for the lock to clear.
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}
