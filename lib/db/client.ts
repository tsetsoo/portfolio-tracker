import "server-only";

import Database from "better-sqlite3";
import { migrate } from "@/lib/db/migrate";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(process.env.DATABASE_PATH ?? "./data/portfolio.db");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
