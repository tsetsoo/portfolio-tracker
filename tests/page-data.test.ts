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
        ('equity-1', 'equity', 'ACME', 'Acme Corp', 'USD', NULL, NULL, '2026-07-20');
      INSERT INTO lots
        (id, holding_id, quantity, cost_per_unit, cost_currency, purchased_at, fees)
      VALUES
        ('lot-1', 'equity-1', 10, 80, 'USD', '2025-01-01', 0);
    `);

    const data = await loadDashboardPageData(db, {
      ...quotes(),
      today: "2026-07-25",
    });

    expect(data.valuation.totalBase).toBe(900);
    expect(data.profitLossPct).toBeCloseTo(25);
    expect(data.snapshots.some((s) => s.date === "2026-07-25")).toBe(true);
  });

  it("loads holdings page valuation with lots keyed by holding id", async () => {
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
    `);

    const data = await loadHoldingsPageData(db, quotes());

    expect(data.valuation.holdings).toHaveLength(1);
    expect(data.lotsByHolding["equity-1"]).toHaveLength(1);
    expect(data.lotsByHolding["equity-1"][0]?.id).toBe("lot-1");
  });
});
