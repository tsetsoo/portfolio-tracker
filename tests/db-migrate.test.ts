import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/migrate";

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles) fs.rmSync(f, { force: true });
});

describe("migrate", () => {
  it("creates tables and default EUR base currency", () => {
    const file = path.join(os.tmpdir(), `pt-${Date.now()}.db`);
    tmpFiles.push(file);
    const db = new Database(file);
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "settings",
        "holdings",
        "lots",
        "price_cache",
        "fx_rates",
        "snapshots",
        "import_batches",
      ]),
    );
    const settings = db.prepare("SELECT base_currency FROM settings WHERE id = 1").get() as {
      base_currency: string;
    };
    expect(settings.base_currency).toBe("EUR");
    db.close();
  });

  it("adds nullable import_batch_id on lots for fresh and existing databases", () => {
    const file = path.join(os.tmpdir(), `pt-lots-${Date.now()}.db`);
    tmpFiles.push(file);
    const db = new Database(file);

    // Simulate a pre-existing DB created before import_batches existed.
    db.exec(`
      CREATE TABLE lots (
        id TEXT PRIMARY KEY,
        holding_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        cost_per_unit REAL NOT NULL,
        cost_currency TEXT NOT NULL,
        purchased_at TEXT NOT NULL,
        fees REAL NOT NULL DEFAULT 0,
        external_trade_id TEXT UNIQUE
      );
    `);

    migrate(db);

    const lotCols = db.prepare("PRAGMA table_info(lots)").all() as {
      name: string;
    }[];
    expect(lotCols.map((c) => c.name)).toContain("import_batch_id");

    const batchCols = db.prepare("PRAGMA table_info(import_batches)").all() as {
      name: string;
    }[];
    expect(batchCols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "broker",
        "source_detail",
        "created_at",
        "file_names_json",
        "lots_inserted",
        "duplicates",
        "closed_count",
        "skipped_count",
        "symbols_touched_json",
        "notes_json",
      ]),
    );

    // Idempotent on re-run.
    migrate(db);
    db.close();
  });
});
