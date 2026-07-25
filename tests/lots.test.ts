import { describe, expect, it } from "vitest";
import { aggregateLots, MixedCostCurrencyError } from "@/lib/domain/lots";

describe("aggregateLots", () => {
  it("computes quantity and weighted average cost", () => {
    const result = aggregateLots([
      {
        id: "1",
        holdingId: "h",
        quantity: 10,
        costPerUnit: 100,
        costCurrency: "EUR",
        purchasedAt: "2024-01-01",
        fees: 0,
        externalTradeId: null,
      },
      {
        id: "2",
        holdingId: "h",
        quantity: 10,
        costPerUnit: 120,
        costCurrency: "EUR",
        purchasedAt: "2024-06-01",
        fees: 0,
        externalTradeId: null,
      },
    ]);
    expect(result.quantity).toBe(20);
    expect(result.avgCostPerUnit).toBe(110);
    expect(result.totalCostNative).toBe(2200);
    expect(result.costCurrency).toBe("EUR");
  });

  it("returns null avg for empty lots", () => {
    expect(aggregateLots([]).avgCostPerUnit).toBeNull();
  });

  it("throws when lots use mixed cost currencies", () => {
    expect(() =>
      aggregateLots([
        {
          id: "1",
          holdingId: "h",
          quantity: 5,
          costPerUnit: 100,
          costCurrency: "EUR",
          purchasedAt: "2024-01-01",
          fees: 0,
          externalTradeId: null,
        },
        {
          id: "2",
          holdingId: "h",
          quantity: 5,
          costPerUnit: 100,
          costCurrency: "USD",
          purchasedAt: "2024-06-01",
          fees: 0,
          externalTradeId: null,
        },
      ]),
    ).toThrow(MixedCostCurrencyError);
  });
});
