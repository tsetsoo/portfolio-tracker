import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseCryptoComTradesCsv } from "@/lib/cryptocom/parse";

const appFixture = path.join(__dirname, "fixtures", "cryptocom-app-sample.csv");
const exchangeFixture = path.join(
  __dirname,
  "fixtures",
  "cryptocom-exchange-sample.csv",
);

describe("parseCryptoComTradesCsv", () => {
  it("parses App crypto_purchase and crypto_exchange buys", () => {
    const result = parseCryptoComTradesCsv(readFileSync(appFixture, "utf8"));

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      symbol: "BTC",
      quantity: 0.01,
      costPerUnit: 85000,
      costCurrency: "EUR",
      purchasedAt: "2025-02-10",
      fees: 0,
      externalTradeId: "cryptocom:hash-btc-1",
    });
    expect(result.rows[1]).toMatchObject({
      symbol: "ETH",
      quantity: 0.5,
      costPerUnit: 3200,
      costCurrency: "USDT",
      purchasedAt: "2025-02-11",
      externalTradeId: "cryptocom:hash-eth-1",
    });
  });

  it("skips sells, rewards, and bad rows from App exports", () => {
    const result = parseCryptoComTradesCsv(readFileSync(appFixture, "utf8"));

    expect(
      result.errors.some((e) => e.message.toLowerCase().includes("sell")),
    ).toBe(true);
    expect(
      result.errors.some((e) => e.message.toLowerCase().includes("skip")),
    ).toBe(true);
    expect(
      result.errors.some(
        (e) =>
          e.message.toLowerCase().includes("quantity") ||
          e.message.toLowerCase().includes("invalid"),
      ),
    ).toBe(true);
  });

  it("parses Exchange spot trade history buys", () => {
    const result = parseCryptoComTradesCsv(
      readFileSync(exchangeFixture, "utf8"),
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      symbol: "BTC",
      quantity: 0.02,
      costPerUnit: 90000,
      costCurrency: "USDT",
      purchasedAt: "2025-02-20",
      fees: 0.9,
      externalTradeId: "cryptocom:TRD-1001",
    });
    expect(result.rows[1]).toMatchObject({
      symbol: "ETH",
      quantity: 0.25,
      costPerUnit: 3000,
      costCurrency: "EUR",
      fees: 0.75,
    });
    expect(
      result.errors.some((e) => e.message.toLowerCase().includes("sell")),
    ).toBe(true);
  });

  it("returns errors for empty or unknown CSV", () => {
    expect(parseCryptoComTradesCsv("   ").rows).toEqual([]);
    expect(parseCryptoComTradesCsv("Foo,Bar\n1,2\n").rows).toEqual([]);
  });
});
