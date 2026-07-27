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
  it("parses buy rows and nets sells FIFO from the spot fixture", () => {
    const csv = readFileSync(fixturePath, "utf8");
    const result = parseBinanceTradesCsv(csv);

    expect(result.rows).toHaveLength(2);
    // BUY 0.01 then SELL 0.005 → 0.005 remaining; fees prorated
    expect(result.rows[0]).toMatchObject({
      symbol: "BTC",
      quantity: 0.005,
      costPerUnit: 85000,
      costCurrency: "USDT",
      purchasedAt: "2025-03-15",
      externalTradeId: expect.stringMatching(/^binance:/),
    });
    expect(result.rows[0].fees).toBeCloseTo(0.00001 * 85000 * 0.5);

    expect(result.rows[1]).toMatchObject({
      symbol: "ETH",
      quantity: 0.5,
      costPerUnit: 3200,
      costCurrency: "USDT",
      purchasedAt: "2025-03-16",
      fees: 0.8,
    });
  });

  it("records applied sells and bad rows in errors", () => {
    const csv = readFileSync(fixturePath, "utf8");
    const result = parseBinanceTradesCsv(csv);

    expect(
      result.errors.some((e) =>
        /applied sell|sold/i.test(e.message),
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

  it("drops fully sold symbols and keeps remaining open lots", () => {
    const csv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n" +
      "2025-01-01 10:00:00,BTCUSDT,BUY,100,1,100,0,USDT\n" +
      "2025-01-02 10:00:00,ETHUSDT,BUY,200,2,400,0,USDT\n" +
      "2025-01-03 10:00:00,BTCUSDT,SELL,110,1,110,0,USDT\n" +
      "2025-01-04 10:00:00,ETHUSDT,SELL,210,0.5,105,0,USDT\n";

    const result = parseBinanceTradesCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "ETH",
      quantity: 1.5,
      costPerUnit: 200,
      purchasedAt: "2025-01-02",
    });
    expect(
      result.errors.some((e) => /closed position:\s*btc/i.test(e.message)),
    ).toBe(true);
  });

  it("applies sells FIFO across multiple lots in chronological order", () => {
    // Newest-first CSV (Binance export style) — must sort before FIFO
    const csv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n" +
      "2025-01-03 12:00:00,BTCUSDT,SELL,120,0.015,1.8,0,USDT\n" +
      "2025-01-02 12:00:00,BTCUSDT,BUY,110,0.02,2.2,0.2,USDT\n" +
      "2025-01-01 12:00:00,BTCUSDT,BUY,100,0.01,1,0.1,USDT\n";

    const result = parseBinanceTradesCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "BTC",
      quantity: 0.015,
      costPerUnit: 110,
      purchasedAt: "2025-01-02",
    });
    // First lot fully consumed; second lot sold 0.005 of 0.02 → fees 0.2 * 0.015/0.02
    expect(result.rows[0].fees).toBeCloseTo(0.15);
  });

  it("skips fiat-base pairs like EURUSDT", () => {
    const csv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n" +
      "2025-01-01 10:00:00,EURUSDT,SELL,1.08,1000EUR,1080,1,USDT\n" +
      "2025-01-02 10:00:00,BTCUSDT,BUY,100,0.01,1,0,USDT\n";

    const result = parseBinanceTradesCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.symbol).toBe("BTC");
    expect(
      result.errors.some((e) => /fiat/i.test(e.message)),
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
