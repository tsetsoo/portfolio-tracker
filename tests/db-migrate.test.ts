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
      ]),
    );
    const settings = db.prepare("SELECT base_currency FROM settings WHERE id = 1").get() as {
      base_currency: string;
    };
    expect(settings.base_currency).toBe("EUR");
    db.close();
  });
});
