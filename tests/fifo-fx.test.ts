import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "@/lib/db/migrate";
import { fifoFxFromDb } from "@/lib/import/fifo-fx";
import { upsertDailyFxRate } from "@/lib/import/fx-daily";

describe("fifoFxFromDb", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    db.prepare("UPDATE settings SET base_currency = 'EUR' WHERE id = 1").run();
  });
  afterEach(() => db.close());

  it("aliases USDT and uses fx_rates_daily for the purchase date", () => {
    upsertDailyFxRate(db, "USD", "EUR", "2021-02-14", 0.83);
    const fx = fifoFxFromDb(db);
    expect(fx.rateToBase("USDT", "2021-02-14")).toBeCloseTo(0.83);
    expect(fx.rateToBase("BGN")).toBeCloseTo(1 / 1.95583);
  });
});
