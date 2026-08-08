import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  commitBinanceImport,
  previewBinanceImport,
} from "@/lib/binance/commit";
import { migrate } from "@/lib/db/migrate";

const fixtureCsv = readFileSync(
  path.join(__dirname, "fixtures", "binance-trades-sample.csv"),
  "utf8",
);

describe("Binance import commit", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts crypto lots and skips trade ids on re-import", () => {
    const preview = previewBinanceImport(db, fixtureCsv);

    expect(preview.toInsert).toHaveLength(2);
    expect(preview.duplicates).toEqual([]);
    expect(commitBinanceImport(db, preview.toInsert)).toMatchObject({
      inserted: 2,
    });

    const holdings = db
      .prepare(
        "SELECT type, symbol, quote_currency FROM holdings ORDER BY symbol",
      )
      .all();
    expect(holdings).toEqual([
      { type: "crypto", symbol: "BTC", quote_currency: "USDT" },
      { type: "crypto", symbol: "ETH", quote_currency: "USDT" },
    ]);

    const lotCount = db
      .prepare("SELECT count(*) AS count FROM lots")
      .get() as { count: number };
    expect(lotCount.count).toBe(2);

    const repeated = previewBinanceImport(db, fixtureCsv);
    expect(repeated.toInsert).toEqual([]);
    expect(repeated.duplicates).toHaveLength(2);
    expect(commitBinanceImport(db, repeated.duplicates)).toMatchObject({
      inserted: 0,
    });
  });

  it("rolls back when a lot insert fails", () => {
    const preview = previewBinanceImport(db, fixtureCsv);
    const secondId = preview.toInsert[1]?.externalTradeId;
    expect(secondId).toBeTruthy();

    db.exec(`
      CREATE TRIGGER reject_second_binance_lot
      BEFORE INSERT ON lots
      WHEN NEW.external_trade_id = '${secondId}'
      BEGIN
        SELECT RAISE(ABORT, 'rejected binance lot');
      END;
    `);

    expect(() => commitBinanceImport(db, preview.toInsert)).toThrow(
      "rejected binance lot",
    );
    expect(
      db.prepare("SELECT count(*) AS count FROM holdings").get(),
    ).toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM lots").get()).toEqual({
      count: 0,
    });
  });

  it("imports Auto-Invest Success rows as crypto lots", () => {
    const autoCsv = readFileSync(
      path.join(__dirname, "fixtures", "binance-auto-invest-sample.csv"),
      "utf8",
    );
    const preview = previewBinanceImport(db, autoCsv, "auto-invest");
    expect(preview.toInsert).toHaveLength(4);
    expect(commitBinanceImport(db, preview.toInsert)).toMatchObject({
      inserted: 4,
    });

    const holdings = db
      .prepare(
        "SELECT type, symbol FROM holdings ORDER BY symbol",
      )
      .all();
    expect(holdings).toEqual([
      { type: "crypto", symbol: "BTC" },
      { type: "crypto", symbol: "ETH" },
    ]);

    const repeated = previewBinanceImport(db, autoCsv, "auto-invest");
    expect(repeated.toInsert).toEqual([]);
    expect(repeated.duplicates).toHaveLength(4);
  });

  it("imports Convert Success buys as crypto lots", () => {
    const convertCsv = readFileSync(
      path.join(__dirname, "fixtures", "binance-convert-sample.csv"),
      "utf8",
    );
    const preview = previewBinanceImport(db, convertCsv, "convert");
    expect(preview.toInsert).toHaveLength(4);
    expect(commitBinanceImport(db, preview.toInsert)).toMatchObject({
      inserted: 4,
    });

    const btc = db
      .prepare(
        `SELECT l.quantity, l.cost_currency, l.external_trade_id
         FROM lots l
         JOIN holdings h ON h.id = l.holding_id
         WHERE h.symbol = 'BTC' AND l.external_trade_id LIKE 'binance-convert:%'
         ORDER BY l.purchased_at`,
      )
      .all() as Array<{
      quantity: number;
      cost_currency: string;
      external_trade_id: string;
    }>;
    expect(btc).toHaveLength(2);
    expect(btc[0]?.cost_currency).toBe("EUR");

    const repeated = previewBinanceImport(db, convertCsv, "convert");
    expect(repeated.toInsert).toEqual([]);
    expect(repeated.duplicates).toHaveLength(4);
  });
});
