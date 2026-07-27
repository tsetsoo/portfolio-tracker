import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseBinanceAutoInvestCsv, parseBinanceTradesCsv } from "@/lib/binance/parse";

const fixturePath = path.join(
  __dirname,
  "fixtures",
  "binance-trades-sample.csv",
);

describe("parseBinanceTradesCsv", () => {
  it("parses buy rows from the Binance spot trades fixture", () => {
    const csv = readFileSync(fixturePath, "utf8");
    const result = parseBinanceTradesCsv(csv);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      symbol: "BTC",
      quantity: 0.01,
      costPerUnit: 85000,
      costCurrency: "USDT",
      purchasedAt: "2025-03-15",
      externalTradeId: expect.stringMatching(/^binance:/),
    });
    // Fee in BTC → converted to USDT via price
    expect(result.rows[0].fees).toBeCloseTo(0.00001 * 85000);

    expect(result.rows[1]).toMatchObject({
      symbol: "ETH",
      quantity: 0.5,
      costPerUnit: 3200,
      costCurrency: "USDT",
      purchasedAt: "2025-03-16",
      fees: 0.8,
    });
  });

  it("skips sells and records bad rows in errors", () => {
    const csv = readFileSync(fixturePath, "utf8");
    const result = parseBinanceTradesCsv(csv);

    expect(
      result.errors.some((e) =>
        e.message.toLowerCase().includes("skipped sell"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (e) =>
          e.message.toLowerCase().includes("price") ||
          e.message.toLowerCase().includes("invalid"),
      ),
    ).toBe(true);
  });

  it("returns errors for empty CSV", () => {
    const result = parseBinanceTradesCsv("  \n  ");
    expect(result.rows).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns errors when required headers are missing", () => {
    const result = parseBinanceTradesCsv("Foo,Bar\n1,2\n");
    expect(result.rows).toEqual([]);
    expect(
      result.errors.some((e) => e.message.toLowerCase().includes("header")),
    ).toBe(true);
  });

  it("parses slash pairs and embedded fee units", () => {
    const csv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n" +
      "2025-04-01 10:00:00,BTC/EUR,BUY,70000,0.02BTC,1400EUR,1.4EUR\n";

    const result = parseBinanceTradesCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "BTC",
      quantity: 0.02,
      costPerUnit: 70000,
      costCurrency: "EUR",
      fees: 1.4,
      purchasedAt: "2025-04-01",
    });
  });
});

describe("parseBinanceAutoInvestCsv", () => {
  it("parses successful Auto-Invest rows into crypto lots", () => {
    const csv = readFileSync(
      path.join(__dirname, "fixtures", "binance-auto-invest-sample.csv"),
      "utf8",
    );
    const result = parseBinanceAutoInvestCsv(csv);

    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]).toMatchObject({
      symbol: "BTC",
      quantity: 0.00089732,
      costCurrency: "EUR",
      purchasedAt: "2026-07-08",
      fees: 0,
      externalTradeId: expect.stringMatching(/^binance-auto:/),
    });
    expect(result.rows[0].costPerUnit).toBeCloseTo(50 / 0.00089732);

    expect(result.rows[1]).toMatchObject({
      symbol: "ETH",
      quantity: 0.03206006,
      costCurrency: "EUR",
      purchasedAt: "2026-07-08",
    });

    expect(result.rows[2]).toMatchObject({
      symbol: "ETH",
      quantity: 0.02920671,
      costCurrency: "USDT",
      purchasedAt: "2024-04-16",
      fees: 0.18,
    });
    expect(result.rows[2].costPerUnit).toBeCloseTo(90 / 0.02920671);

    expect(
      result.errors.some((e) => e.message.toLowerCase().includes("failed")),
    ).toBe(true);
  });

  it("returns a header error for non Auto-Invest CSVs", () => {
    const result = parseBinanceAutoInvestCsv(
      "Date(UTC),Pair,Side,Price,Executed\n2025-01-01,BTCUSDT,BUY,1,1\n",
    );
    expect(result.rows).toEqual([]);
    expect(
      result.errors.some((e) => e.message.toLowerCase().includes("header")),
    ).toBe(true);
  });
});
