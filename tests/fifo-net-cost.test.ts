import { describe, expect, it } from "vitest";

import {
  createFifoFxLookup,
  netFillsFifo,
  type LotFill,
} from "@/lib/import/fifo-net";

describe("netFillsFifo withdrawal cost", () => {
  it("attributes FIFO cost basis to withdrawal fills", () => {
    const fills: LotFill[] = [
      {
        line: 2,
        order: 0,
        sortKey: "2025-01-01T10:00:00",
        side: "BUY",
        row: {
          symbol: "ETH",
          quantity: 2,
          costPerUnit: 2000,
          costCurrency: "EUR",
          purchasedAt: "2025-01-01",
          fees: 0,
          externalTradeId: "cryptocom:buy",
        },
      },
      {
        line: 3,
        order: 1,
        sortKey: "2025-01-02T10:00:00",
        side: "SELL",
        disposition: "withdrawal",
        row: {
          symbol: "ETH",
          quantity: 1.5,
          costPerUnit: 0,
          costCurrency: "USD",
          purchasedAt: "2025-01-02",
          fees: 0,
          externalTradeId: "cryptocom:0xw2",
        },
      },
    ];

    const result = netFillsFifo(fills);
    expect(result.rows[0]?.quantity).toBeCloseTo(0.5);
    expect(result.consumed).toHaveLength(1);
    expect(result.consumed[0]).toMatchObject({
      externalTradeId: "cryptocom:0xw2",
      symbol: "ETH",
      quantity: 1.5,
      costCurrency: "EUR",
      disposition: "withdrawal",
    });
    expect(result.consumed[0]!.costBasis).toBeCloseTo(3000);
  });

  it("converts mixed EUR/BGN lot costs into base via FX lookup", () => {
    const fills: LotFill[] = [
      {
        line: 2,
        order: 0,
        sortKey: "2020-01-01T10:00:00",
        side: "BUY",
        row: {
          symbol: "BTC",
          quantity: 0.5,
          costPerUnit: 10000,
          costCurrency: "EUR",
          purchasedAt: "2020-01-01",
          fees: 0,
          externalTradeId: "buy-eur",
        },
      },
      {
        line: 3,
        order: 1,
        sortKey: "2020-06-01T10:00:00",
        side: "BUY",
        row: {
          symbol: "BTC",
          quantity: 0.5,
          costPerUnit: 19558.3,
          costCurrency: "BGN",
          purchasedAt: "2020-06-01",
          fees: 0,
          externalTradeId: "buy-bgn",
        },
      },
      {
        line: 4,
        order: 2,
        sortKey: "2021-01-01T10:00:00",
        side: "SELL",
        disposition: "withdrawal",
        row: {
          symbol: "BTC",
          quantity: 1,
          costPerUnit: 0,
          costCurrency: "EUR",
          purchasedAt: "2021-01-01",
          fees: 0,
          externalTradeId: "cryptocom:0xw",
        },
      },
    ];

    const result = netFillsFifo(
      fills,
      createFifoFxLookup({ baseCurrency: "EUR" }),
    );
    expect(result.consumed).toHaveLength(1);
    // 0.5*10000 EUR + 0.5*19558.3 BGN / 1.95583 ≈ 5000 + 5000
    expect(result.consumed[0]!.costCurrency).toBe("EUR");
    expect(result.consumed[0]!.costBasis).toBeCloseTo(10000, 0);
    expect(result.consumed[0]!.partial).toBeFalsy();
  });

  it("converts USDT lots using dated rateToBase(purchasedAt)", () => {
    const rates: Record<string, number> = { "2021-02-14": 0.83 };
    const fx = createFifoFxLookup({
      baseCurrency: "EUR",
      getDailyRate: (from, to, date) =>
        from === "USD" && to === "EUR" ? rates[date] ?? null : null,
    });
    const fills: LotFill[] = [
      {
        line: 2,
        order: 0,
        sortKey: "2021-02-14T10:00:00",
        side: "BUY",
        row: {
          symbol: "ETH",
          quantity: 1,
          costPerUnit: 1000,
          costCurrency: "USDT",
          purchasedAt: "2021-02-14",
          fees: 0,
          externalTradeId: "buy-usdt",
        },
      },
      {
        line: 3,
        order: 1,
        sortKey: "2021-03-01T10:00:00",
        side: "SELL",
        disposition: "withdrawal",
        row: {
          symbol: "ETH",
          quantity: 1,
          costPerUnit: 0,
          costCurrency: "EUR",
          purchasedAt: "2021-03-01",
          fees: 0,
          externalTradeId: "wd:0x1",
        },
      },
    ];
    const result = netFillsFifo(fills, fx);
    expect(result.consumed[0]!.costBasis).toBeCloseTo(830);
    expect(result.consumed[0]!.costCurrency).toBe("EUR");
    expect(result.consumed[0]!.partial).toBeFalsy();
  });

  it("marks partial and lists missing crypto quote currencies", () => {
    const fx = createFifoFxLookup({
      baseCurrency: "EUR",
      // Fiat daily rates only — CRO has no crypto→EUR cache yet.
      getDailyRate: (from, to) =>
        from === "USD" && to === "EUR" ? 0.9 : null,
    });
    const fills: LotFill[] = [
      {
        line: 2,
        order: 0,
        sortKey: "2022-01-01T10:00:00",
        side: "BUY",
        row: {
          symbol: "BTC",
          quantity: 0.5,
          costPerUnit: 10000,
          costCurrency: "EUR",
          purchasedAt: "2022-01-01",
          fees: 0,
          externalTradeId: "buy-eur",
        },
      },
      {
        line: 3,
        order: 1,
        sortKey: "2022-08-20T10:00:00",
        side: "BUY",
        row: {
          symbol: "BTC",
          quantity: 0.5,
          costPerUnit: 100,
          costCurrency: "CRO",
          purchasedAt: "2022-08-20",
          fees: 0,
          externalTradeId: "buy-cro",
        },
      },
      {
        line: 4,
        order: 2,
        sortKey: "2022-08-21T10:00:00",
        side: "SELL",
        disposition: "withdrawal",
        row: {
          symbol: "BTC",
          quantity: 1,
          costPerUnit: 0,
          costCurrency: "EUR",
          purchasedAt: "2022-08-21",
          fees: 0,
          externalTradeId: "wd:btc",
        },
      },
    ];
    const result = netFillsFifo(fills, fx);
    expect(result.consumed[0]!.partial).toBe(true);
    expect(result.consumed[0]!.costBasis).toBeCloseTo(5000);
    expect(result.consumed[0]!.missingCurrencies).toEqual(["CRO"]);
  });

  it("converts CRO lot costs via dated crypto→EUR daily rate", () => {
    const fx = createFifoFxLookup({
      baseCurrency: "EUR",
      getDailyRate: (from, to, date) =>
        from === "CRO" && to === "EUR" && date === "2022-08-20" ? 0.12 : null,
    });
    const fills: LotFill[] = [
      {
        line: 2,
        order: 0,
        sortKey: "2022-08-20T10:00:00",
        side: "BUY",
        row: {
          symbol: "ETH",
          quantity: 1,
          costPerUnit: 1000,
          costCurrency: "CRO",
          purchasedAt: "2022-08-20",
          fees: 0,
          externalTradeId: "buy-cro",
        },
      },
      {
        line: 3,
        order: 1,
        sortKey: "2022-08-21T10:00:00",
        side: "SELL",
        disposition: "withdrawal",
        row: {
          symbol: "ETH",
          quantity: 1,
          costPerUnit: 0,
          costCurrency: "EUR",
          purchasedAt: "2022-08-21",
          fees: 0,
          externalTradeId: "wd:eth",
        },
      },
    ];
    const result = netFillsFifo(fills, fx);
    expect(result.consumed[0]!.partial).toBeFalsy();
    expect(result.consumed[0]!.costBasis).toBeCloseTo(120);
    expect(result.consumed[0]!.costCurrency).toBe("EUR");
  });

  it("emits a zero-basis partial settlement when every FX rate is missing", () => {
    const fills: LotFill[] = [
      {
        line: 2,
        order: 0,
        sortKey: "2022-08-20T10:00:00",
        side: "BUY",
        row: {
          symbol: "BTC",
          quantity: 1,
          costPerUnit: 100,
          costCurrency: "CRO",
          purchasedAt: "2022-08-20",
          fees: 0,
          externalTradeId: "buy-cro",
        },
      },
      {
        line: 3,
        order: 1,
        sortKey: "2022-08-21T10:00:00",
        side: "SELL",
        disposition: "withdrawal",
        row: {
          symbol: "BTC",
          quantity: 1,
          costPerUnit: 0,
          costCurrency: "EUR",
          purchasedAt: "2022-08-21",
          fees: 0,
          externalTradeId: "wd:btc",
        },
      },
    ];

    const result = netFillsFifo(
      fills,
      createFifoFxLookup({ baseCurrency: "EUR" }),
    );

    expect(result.consumed).toHaveLength(1);
    expect(result.consumed[0]).toMatchObject({
      costBasis: 0,
      costCurrency: "EUR",
      partial: true,
      missingCurrencies: ["CRO"],
    });
  });
});
