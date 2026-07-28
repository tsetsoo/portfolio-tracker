import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "@/lib/db/migrate";
import { createHolding } from "@/lib/holdings-repo";
import { createImportBatch } from "@/lib/import/batches";
import { resetPortfolioData } from "@/lib/portfolio/reset";
import { getSettings, setBaseCurrency } from "@/lib/settings";

describe("resetPortfolioData", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("deletes holdings, lots, snapshots, and import batches but keeps settings and caches", () => {
    setBaseCurrency(db, "GBP");

    const holding = createHolding(db, {
      type: "equity",
      name: "Apple",
      symbol: "AAPL",
      quoteCurrency: "USD",
      lot: {
        quantity: 2,
        costPerUnit: 100,
        costCurrency: "USD",
        purchasedAt: "2026-01-01",
      },
    });

    const batch = createImportBatch(db, {
      name: "IBKR test",
      broker: "ibkr",
      sourceDetail: "trades",
    });
    db.prepare("UPDATE lots SET import_batch_id = ? WHERE holding_id = ?").run(
      batch.id,
      holding.id,
    );

    db.prepare(
      `INSERT INTO snapshots (date, total_base, breakdown_json)
       VALUES (?, ?, ?)`,
    ).run("2026-07-01", 1000, "{}");
    db.prepare(
      `INSERT INTO price_cache (symbol, asset_class, price, currency, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("AAPL", "equity", 200, "USD", "2026-07-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO fx_rates (from_currency, to_currency, rate, fetched_at)
       VALUES (?, ?, ?, ?)`,
    ).run("USD", "GBP", 0.78, "2026-07-01T00:00:00.000Z");

    const result = resetPortfolioData(db);

    expect(result).toEqual({
      holdingsDeleted: 1,
      lotsDeleted: 1,
      snapshotsDeleted: 1,
      importBatchesDeleted: 1,
    });
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM holdings").get() as { n: number })
        .n,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM lots").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number })
        .n,
    ).toBe(0);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM import_batches").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
    expect(getSettings(db).baseCurrency).toBe("GBP");
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM price_cache").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM fx_rates").get() as { n: number })
        .n,
    ).toBe(1);
  });
});
