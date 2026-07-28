import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "@/lib/db/migrate";
import {
  addLot,
  createHolding,
  deleteHolding,
  listHoldingsWithLots,
  updateManualValue,
} from "@/lib/holdings-repo";

describe("holdings repository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates an equity with an initial lot and maps database fields", () => {
    const holding = createHolding(db, {
      type: "equity",
      name: "Apple",
      symbol: "AAPL",
      quoteCurrency: "USD",
      lot: {
        quantity: 2.5,
        costPerUnit: 180,
        costCurrency: "USD",
        purchasedAt: "2026-01-15",
        fees: 1.25,
        externalTradeId: "trade-1",
      },
    });

    const result = listHoldingsWithLots(db);

    expect(holding).toMatchObject({
      type: "equity",
      name: "Apple",
      symbol: "AAPL",
      quoteCurrency: "USD",
      manualValue: null,
      notes: null,
    });
    expect(holding.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).toEqual([
      {
        ...holding,
        lots: [
          {
            id: expect.stringMatching(/^[0-9a-f-]{36}$/),
            holdingId: holding.id,
            quantity: 2.5,
            costPerUnit: 180,
            costCurrency: "USD",
            purchasedAt: "2026-01-15",
            fees: 1.25,
            externalTradeId: "trade-1",
            importBatchId: null,
          },
        ],
      },
    ]);
  });

  it("creates a manual holding and updates its value", () => {
    const holding = createHolding(db, {
      type: "manual",
      name: "Savings account",
      manualValue: 1500,
    });

    const updated = updateManualValue(db, holding.id, 1750.5);

    expect(updated).toMatchObject({
      id: holding.id,
      type: "manual",
      name: "Savings account",
      symbol: null,
      quoteCurrency: null,
      manualValue: 1750.5,
      notes: null,
    });
    expect(listHoldingsWithLots(db)).toEqual([{ ...updated, lots: [] }]);
  });

  it("adds a lot to an existing holding", () => {
    const holding = createHolding(db, {
      type: "crypto",
      name: "Bitcoin",
      symbol: "BTC",
      quoteCurrency: "EUR",
    });

    const lot = addLot(db, holding.id, {
      quantity: 0.25,
      costPerUnit: 60_000,
      costCurrency: "EUR",
      purchasedAt: "2026-03-04",
    });

    expect(lot).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      holdingId: holding.id,
      quantity: 0.25,
      costPerUnit: 60_000,
      costCurrency: "EUR",
      purchasedAt: "2026-03-04",
      fees: 0,
      externalTradeId: null,
      importBatchId: null,
    });
  });

  it("deleting a holding cascades to its lots", () => {
    const holding = createHolding(db, {
      type: "equity",
      name: "Vanguard FTSE All-World",
      symbol: "VWCE",
      quoteCurrency: "EUR",
      lot: {
        quantity: 3,
        costPerUnit: 125,
        costCurrency: "EUR",
        purchasedAt: "2026-02-10",
      },
    });

    deleteHolding(db, holding.id);

    expect(listHoldingsWithLots(db)).toEqual([]);
    expect(
      (
        db
          .prepare("SELECT count(*) AS count FROM lots WHERE holding_id = ?")
          .get(holding.id) as { count: number }
      ).count,
    ).toBe(0);
  });
});
