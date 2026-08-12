import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { migrate } from "@/lib/db/migrate";
import {
  loadDashboardPageData,
  loadHoldingsPageData,
} from "@/lib/portfolio/page-data";
import type { QuoteService } from "@/lib/quotes/types";

const databases: Database.Database[] = [];

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function quotes(): Pick<QuoteService, "getQuote" | "getFxRate"> {
  return {
    getQuote: vi.fn(async () => ({
      price: 100,
      currency: "USD",
      stale: false,
      fetchedAt: "2026-07-25T09:00:00.000Z",
    })),
    getFxRate: vi.fn(async () => ({ rate: 0.9, stale: false })),
  };
}

describe("page data loaders", () => {
  it("loads dashboard valuation, snapshots, and P/L percent", async () => {
    const db = makeDb();
    db.exec(`
      UPDATE settings SET base_currency = 'EUR' WHERE id = 1;
      INSERT INTO holdings
        (id, type, symbol, name, quote_currency, manual_value, notes, updated_at)
      VALUES
        ('equity-1', 'equity', 'ACME', 'Acme Corp', 'USD', NULL, NULL, '2026-07-20'),
        ('crypto-1', 'crypto', 'BTC', 'Bitcoin', 'EUR', NULL, NULL, '2026-07-20');
      INSERT INTO lots
        (id, holding_id, quantity, cost_per_unit, cost_currency, purchased_at, fees)
      VALUES
        ('lot-1', 'equity-1', 10, 80, 'USD', '2025-01-01', 0),
        ('lot-c', 'crypto-1', 1, 10000, 'EUR', '2025-01-01', 0);
      INSERT INTO wallets
        (id, chain, address, balance, balance_asset, created_at)
      VALUES
        ('w-eth', 'eth', '0xabc', 2, 'ETH', '2026-07-20');
    `);

    const getQuote = vi.fn(async (symbol: string) => {
      if (symbol === "ETH") {
        return {
          price: 3000,
          currency: "EUR",
          stale: false,
          fetchedAt: "2026-07-25T09:00:00.000Z",
        };
      }
      if (symbol === "ACME") {
        return {
          price: 100,
          currency: "USD",
          stale: false,
          fetchedAt: "2026-07-25T09:00:00.000Z",
        };
      }
      throw new Error(`no quote for ${symbol}`);
    });

    const getCryptoQuotes = vi.fn(async (symbols: string[]) => {
      const map = new Map();
      for (const symbol of symbols) {
        if (symbol === "ETH") {
          map.set("ETH", {
            price: 3000,
            currency: "EUR",
            stale: false,
            fetchedAt: "2026-07-25T09:00:00.000Z",
          });
        } else {
          // Handpicked STX/AVAX/DOT — price at 0 so they don't affect total.
          map.set(symbol, {
            price: 0,
            currency: "EUR",
            stale: false,
            fetchedAt: "2026-07-25T09:00:00.000Z",
          });
        }
      }
      return map;
    });

    const data = await loadDashboardPageData(db, {
      getQuote,
      getCryptoQuotes,
      getFxRate: vi.fn(async () => ({ rate: 0.9, stale: false })),
      today: "2026-07-25",
    });

    // Equity 900 + wallet ETH 6000 — exchange crypto holding excluded.
    expect(data.valuation.totalBase).toBe(6900);
    expect(
      data.valuation.holdings.some((h) => h.holding.id === "crypto-1"),
    ).toBe(false);
    expect(
      data.valuation.holdings.some((h) => h.holding.id === "wallet:ETH"),
    ).toBe(true);
    expect(data.snapshots.some((s) => s.date === "2026-07-25")).toBe(true);
  });

  it("cacheOnly dashboard load skips writing a snapshot when prices are stale", async () => {
    const db = makeDb();
    db.exec(`
      UPDATE settings SET base_currency = 'EUR' WHERE id = 1;
      INSERT INTO holdings
        (id, type, symbol, name, quote_currency, manual_value, notes, updated_at)
      VALUES
        ('equity-1', 'equity', 'ACME', 'Acme Corp', 'USD', NULL, NULL, '2026-07-20');
      INSERT INTO lots
        (id, holding_id, quantity, cost_per_unit, cost_currency, purchased_at, fees)
      VALUES
        ('lot-1', 'equity-1', 10, 80, 'USD', '2025-01-01', 0);
      INSERT INTO price_cache
        (symbol, asset_class, price, currency, fetched_at)
      VALUES
        ('ACME', 'equity', 100, 'USD', '2026-07-25T08:00:00.000Z');
      INSERT INTO fx_rates
        (from_currency, to_currency, rate, fetched_at)
      VALUES
        ('USD', 'EUR', 0.9, '2026-07-25T08:00:00.000Z');
    `);

    const data = await loadDashboardPageData(db, {
      cacheOnly: true,
      today: "2026-07-25",
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(data.valuation.totalBase).toBe(900);
    expect(data.valuation.pricesOutdated).toBe(true);
    expect(data.snapshots.some((s) => s.date === "2026-07-25")).toBe(false);
  });

  it("loads holdings page with same crypto sources as home", async () => {
    const db = makeDb();
    db.exec(`
      UPDATE settings SET base_currency = 'EUR' WHERE id = 1;
      INSERT INTO holdings
        (id, type, symbol, name, quote_currency, manual_value, notes, updated_at)
      VALUES
        ('equity-1', 'equity', 'ACME', 'Acme Corp', 'USD', NULL, NULL, '2026-07-20'),
        ('crypto-1', 'crypto', 'BTC', 'Bitcoin', 'EUR', NULL, NULL, '2026-07-20');
      INSERT INTO lots
        (id, holding_id, quantity, cost_per_unit, cost_currency, purchased_at, fees)
      VALUES
        ('lot-1', 'equity-1', 10, 80, 'USD', '2025-01-01', 0),
        ('lot-c', 'crypto-1', 1, 10000, 'EUR', '2025-01-01', 0);
      INSERT INTO wallets
        (id, chain, address, balance, balance_asset, created_at)
      VALUES
        ('w-eth', 'eth', '0xabc', 2, 'ETH', '2026-07-20');
    `);

    const getQuote = vi.fn(async (symbol: string) => {
      if (symbol === "ACME") {
        return {
          price: 100,
          currency: "USD",
          stale: false,
          fetchedAt: "2026-07-25T09:00:00.000Z",
        };
      }
      throw new Error(`no quote for ${symbol}`);
    });
    const getCryptoQuotes = vi.fn(async (symbols: string[]) => {
      const map = new Map();
      for (const symbol of symbols) {
        map.set(symbol, {
          price: symbol === "ETH" ? 3000 : 0,
          currency: "EUR",
          stale: false,
          fetchedAt: "2026-07-25T09:00:00.000Z",
        });
      }
      return map;
    });

    const data = await loadHoldingsPageData(db, {
      getQuote,
      getCryptoQuotes,
      getFxRate: vi.fn(async () => ({ rate: 0.9, stale: false })),
    });

    expect(
      data.valuation.holdings.some((h) => h.holding.id === "crypto-1"),
    ).toBe(false);
    expect(
      data.valuation.holdings.some((h) => h.holding.id === "wallet:ETH"),
    ).toBe(true);
    expect(
      data.valuation.holdings.some((h) => h.holding.id === "equity-1"),
    ).toBe(true);
    expect(data.lotsByHolding["equity-1"]).toHaveLength(1);
    expect(data.lotsByHolding["equity-1"][0]?.id).toBe("lot-1");
    expect(data.lotsByHolding["crypto-1"]).toBeUndefined();
  });
});
