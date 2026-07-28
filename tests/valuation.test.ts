import { describe, expect, it } from "vitest";
import { convertAmount, valueHolding } from "@/lib/domain/valuation";

describe("convertAmount", () => {
  it("converts using rate map", () => {
    expect(convertAmount(100, "USD", "EUR", { "USD>EUR": 0.9 })).toBe(90);
  });
  it("identity when same currency", () => {
    expect(convertAmount(50, "EUR", "EUR", {})).toBe(50);
  });
});

describe("valueHolding", () => {
  it("values equity with P&L in base", () => {
    const valued = valueHolding({
      holding: {
        id: "h1",
        type: "equity",
        symbol: "VWCE.DE",
        name: "VWCE",
        quoteCurrency: "EUR",
        manualValue: null,
        notes: null,
        updatedAt: "2026-01-01",
      },
      lots: [
        {
          id: "l1",
          holdingId: "h1",
          quantity: 10,
          costPerUnit: 100,
          costCurrency: "EUR",
          purchasedAt: "2024-01-01",
          fees: 0,
          externalTradeId: null,
          importBatchId: null,
        },
      ],
      price: { price: 120, currency: "EUR" },
      baseCurrency: "EUR",
      fxRates: {},
    });
    expect(valued.quantity).toBe(10);
    expect(valued.avgCostPerUnit).toBe(100);
    expect(valued.currentValueBase).toBe(1200);
    expect(valued.costBasisBase).toBe(1000);
    expect(valued.unrealizedPlBase).toBe(200);
    expect(valued.unrealizedPlPct).toBeCloseTo(20);
  });

  it("values mixed-currency lots without native avg cost", () => {
    const valued = valueHolding({
      holding: {
        id: "h1",
        type: "equity",
        symbol: "AAPL",
        name: "Apple",
        quoteCurrency: "USD",
        manualValue: null,
        notes: null,
        updatedAt: "2026-01-01",
      },
      lots: [
        {
          id: "l1",
          holdingId: "h1",
          quantity: 10,
          costPerUnit: 100,
          costCurrency: "USD",
          purchasedAt: "2024-01-01",
          fees: 0,
          externalTradeId: null,
          importBatchId: null,
        },
        {
          id: "l2",
          holdingId: "h1",
          quantity: 5,
          costPerUnit: 80,
          costCurrency: "EUR",
          purchasedAt: "2024-06-01",
          fees: 0,
          externalTradeId: null,
          importBatchId: null,
        },
      ],
      price: { price: 150, currency: "USD" },
      baseCurrency: "USD",
      fxRates: { "EUR>USD": 1.1 },
    });
    expect(valued.quantity).toBe(15);
    expect(valued.avgCostPerUnit).toBeNull();
    expect(valued.costBasisBase).toBe(1440);
    expect(valued.currentValueBase).toBe(2250);
  });

  it("converts avg cost per unit to base currency", () => {
    const valued = valueHolding({
      holding: {
        id: "h1",
        type: "equity",
        symbol: "AAPL",
        name: "Apple",
        quoteCurrency: "USD",
        manualValue: null,
        notes: null,
        updatedAt: "2026-01-01",
      },
      lots: [
        {
          id: "l1",
          holdingId: "h1",
          quantity: 10,
          costPerUnit: 100,
          costCurrency: "USD",
          purchasedAt: "2024-01-01",
          fees: 0,
          externalTradeId: null,
          importBatchId: null,
        },
      ],
      price: { price: 150, currency: "USD" },
      baseCurrency: "EUR",
      fxRates: { "USD>EUR": 0.9 },
    });

    // Native avg cost is 100 USD/unit; displayed in the EUR base currency.
    expect(valued.avgCostPerUnit).toBeCloseTo(90);
  });

  it("does not show a fake loss when there is no live price", () => {
    const valued = valueHolding({
      holding: {
        id: "h1",
        type: "equity",
        symbol: "AAPL",
        name: "Apple",
        quoteCurrency: "USD",
        manualValue: null,
        notes: null,
        updatedAt: "2026-01-01",
      },
      lots: [
        {
          id: "l1",
          holdingId: "h1",
          quantity: 10,
          costPerUnit: 100,
          costCurrency: "USD",
          purchasedAt: "2024-01-01",
          fees: 0,
          externalTradeId: null,
          importBatchId: null,
        },
      ],
      price: null,
      baseCurrency: "USD",
      fxRates: {},
    });

    expect(valued.currentValueBase).toBe(0);
    expect(valued.unrealizedPlBase).toBeNull();
    expect(valued.unrealizedPlPct).toBeNull();
  });

  it("manual without cost has null P&L", () => {
    const valued = valueHolding({
      holding: {
        id: "c1",
        type: "manual",
        symbol: null,
        name: "Cash EUR",
        quoteCurrency: "EUR",
        manualValue: 5000,
        notes: null,
        updatedAt: "2026-01-01",
      },
      lots: [],
      price: null,
      baseCurrency: "EUR",
      fxRates: {},
    });
    expect(valued.currentValueBase).toBe(5000);
    expect(valued.unrealizedPlBase).toBeNull();
  });
});
