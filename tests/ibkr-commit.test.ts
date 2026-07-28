import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "@/lib/db/migrate";
import {
  commitIbkrImport,
  previewIbkrImport,
} from "@/lib/ibkr/commit";
import { createImportBatch } from "@/lib/import/batches";

const fixtureCsv = readFileSync(
  path.join(__dirname, "fixtures", "ibkr-trades-sample.csv"),
  "utf8",
);

describe("IBKR import commit", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("previews and inserts buy lots, then skips their trade ids on re-import", () => {
    const preview = previewIbkrImport(db, fixtureCsv);

    expect(preview.toInsert).toHaveLength(2);
    expect(preview.duplicates).toEqual([]);
    expect(preview.errors).toHaveLength(2);
    expect(commitIbkrImport(db, preview.toInsert)).toEqual({ inserted: 2 });

    const holdings = db
      .prepare(
        "SELECT symbol, name, quote_currency FROM holdings ORDER BY symbol",
      )
      .all();
    const lots = db
      .prepare(
        `SELECT quantity, cost_per_unit, cost_currency, fees, external_trade_id
         FROM lots ORDER BY external_trade_id`,
      )
      .all();

    expect(holdings).toEqual([
      { symbol: "AAPL", name: "AAPL", quote_currency: "USD" },
      { symbol: "MSFT", name: "MSFT", quote_currency: "USD" },
    ]);
    expect(lots).toEqual([
      {
        quantity: 7,
        cost_per_unit: 150.25,
        cost_currency: "USD",
        fees: 0.7,
        external_trade_id: "TR-1001",
      },
      {
        quantity: 5,
        cost_per_unit: 420,
        cost_currency: "USD",
        fees: 0.75,
        external_trade_id: "TR-1002",
      },
    ]);

    const repeated = previewIbkrImport(db, fixtureCsv);
    expect(repeated.toInsert).toEqual([]);
    expect(repeated.duplicates).toHaveLength(2);
    expect(commitIbkrImport(db, repeated.duplicates)).toEqual({ inserted: 0 });
  });

  it("links inserted lots to an import batch when provided", () => {
    const preview = previewIbkrImport(db, fixtureCsv);
    const batch = createImportBatch(db, {
      name: "IBKR July",
      broker: "ibkr",
      sourceDetail: "trades",
    });

    expect(
      commitIbkrImport(db, preview.toInsert, { importBatchId: batch.id }),
    ).toEqual({ inserted: 2 });

    const linked = db
      .prepare(
        "SELECT COUNT(*) AS n FROM lots WHERE import_batch_id = ?",
      )
      .get(batch.id) as { n: number };
    expect(linked.n).toBe(2);
  });

  it("rolls back all holdings and lots when a row fails", () => {
    const preview = previewIbkrImport(db, fixtureCsv);
    db.exec(`
      CREATE TRIGGER reject_msft_lot
      BEFORE INSERT ON lots
      WHEN NEW.external_trade_id = 'TR-1002'
      BEGIN
        SELECT RAISE(ABORT, 'rejected test lot');
      END;
    `);

    expect(() => commitIbkrImport(db, preview.toInsert)).toThrow(
      "rejected test lot",
    );
    expect(
      db.prepare("SELECT count(*) AS count FROM holdings").get(),
    ).toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM lots").get()).toEqual({
      count: 0,
    });
  });
});
