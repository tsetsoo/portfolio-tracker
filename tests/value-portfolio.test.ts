import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { migrate } from "@/lib/db/migrate";
import { valuePortfolio } from "@/lib/portfolio/value-portfolio";
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

describe("valuePortfolio", () => {
  it("values database holdings with injected quotes and marks stale prices", async () => {
    const db = makeDb();
    db.exec(`
      UPDATE settings SET base_currency = 'EUR' WHERE id = 1;
      INSERT INTO holdings
        (id, type, symbol, name, quote_currency, manual_value, notes, updated_at)
      VALUES
        ('equity-1', 'equity', 'ACME', 'Acme Corp', 'USD', NULL, NULL, '2026-07-20'),
        ('manual-1', 'manual', NULL, 'Emergency fund', 'GBP', 500, NULL, '2026-07-20');
      INSERT INTO lots
        (id, holding_id, quantity, cost_per_unit, cost_currency, purchased_at, fees)
      VALUES
        ('lot-1', 'equity-1', 10, 80, 'USD', '2025-01-01', 0);
    `);

    const getQuote: QuoteService["getQuote"] = vi.fn(async () => ({
      price: 100,
      currency: "USD",
      stale: true,
      fetchedAt: "2026-07-25T09:00:00.000Z",
    }));
    const getFxRate: QuoteService["getFxRate"] = vi.fn(
      async (from, to) => {
        const rates: Record<string, number> = {
          "USD>EUR": 0.9,
          "GBP>EUR": 1.2,
        };
        return { rate: rates[`${from}>${to}`], stale: false };
      },
    );

    const valuation = await valuePortfolio(db, {
      forceRefresh: true,
      getQuote,
      getFxRate,
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(valuation).toMatchObject({
      baseCurrency: "EUR",
      totalBase: 1500,
      totalCostBase: 720,
      unrealizedPlBase: 180,
      pricesOutdated: true,
      asOf: "2026-07-25T12:00:00.000Z",
    });
    expect(valuation.holdings).toHaveLength(2);
    expect(valuation.holdings[0]).toMatchObject({
      quantity: 10,
      currentValueBase: 900,
      costBasisBase: 720,
      unrealizedPlBase: 180,
    });
    expect(valuation.holdings[1]).toMatchObject({
      quantity: 0,
      currentValueBase: 600,
      costBasisBase: null,
      unrealizedPlBase: null,
    });
    expect(getQuote).toHaveBeenCalledWith("ACME", "equity", { force: true });
  });

  it("returns zero totals for an empty portfolio without quote calls", async () => {
    const db = makeDb();
    const getQuote: QuoteService["getQuote"] = vi.fn();
    const getFxRate: QuoteService["getFxRate"] = vi.fn();

    const valuation = await valuePortfolio(db, {
      getQuote,
      getFxRate,
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(valuation).toEqual({
      baseCurrency: "EUR",
      totalBase: 0,
      totalCostBase: 0,
      unrealizedPlBase: 0,
      holdings: [],
      pricesOutdated: false,
      asOf: "2026-07-25T12:00:00.000Z",
    });
  });
});
