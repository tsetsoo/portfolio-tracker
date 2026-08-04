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
  it("parses App buys, nets sells FIFO, and uses To Currency for recurring buys", () => {
    const result = parseCryptoComTradesCsv(readFileSync(appFixture, "utf8"));

    // BTC: 0.01 purchase - 0.005 viban sell + 0.001 recurring = 0.006 across lots
    // ETH: 0.5 from exchange
    const btcLots = result.rows.filter((r) => r.symbol === "BTC");
    const eth = result.rows.find((r) => r.symbol === "ETH");
    expect(btcLots.reduce((sum, r) => sum + r.quantity, 0)).toBeCloseTo(0.006);
    expect(eth).toMatchObject({
      symbol: "ETH",
      quantity: 0.5,
      costPerUnit: 3200,
      costCurrency: "USDT",
      purchasedAt: "2025-02-11",
      externalTradeId: "cryptocom:hash-eth-1",
    });
    expect(result.rows).toHaveLength(3);
    expect(
      result.errors.some((e) => /applied sell/i.test(e.message)),
    ).toBe(true);
  });

  it("skips rewards and bad rows from App exports", () => {
    const result = parseCryptoComTradesCsv(readFileSync(appFixture, "utf8"));

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

  it("drops fully sold App positions and skips fiat buy symbols", () => {
    const csv =
      "Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash\n" +
      "2025-01-01 10:00:00,Buy BTC,BTC,1,,,EUR,100,100,crypto_purchase,h1\n" +
      "2025-01-02 10:00:00,Sell BTC,BTC,-1,EUR,120,EUR,120,120,crypto_viban_exchange,h2\n" +
      "2025-01-03 10:00:00,Buy ETH,EUR,50,ETH,0.02,EUR,50,50,recurring_buy_order,h3\n";

    const result = parseCryptoComTradesCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "ETH",
      quantity: 0.02,
      costPerUnit: 2500,
      costCurrency: "EUR",
    });
    expect(
      result.errors.some((e) => /closed position:\s*btc/i.test(e.message)),
    ).toBe(true);
  });

  it("treats withdrawals as sells for FIFO netting", () => {
    const csv =
      "Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash\n" +
      "2025-01-01 10:00:00,Buy ETH,ETH,2,,,EUR,4000,4000,crypto_purchase,w1\n" +
      "2025-01-02 10:00:00,Withdraw ETH,ETH,-1.5,,,EUR,3000,3000,crypto_withdrawal,w2\n";

    const result = parseCryptoComTradesCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "ETH",
      quantity: 0.5,
    });
    expect(
      result.errors.some((e) =>
        /applied withdrawal:\s*1\.5 eth/i.test(e.message),
      ),
    ).toBe(true);
    expect(result.withdrawalCosts).toHaveLength(1);
    expect(result.withdrawalCosts[0]).toMatchObject({
      externalTradeId: "cryptocom:w2",
      asset: "ETH",
      quantity: 1.5,
      costCurrency: "EUR",
    });
    expect(result.withdrawalCosts[0]!.costBasis).toBeCloseTo(3000);
  });

  it("nets wallet swap debit/credit so converted assets leave inventory", () => {
    const csv =
      "Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash\n" +
      "2025-01-01 10:00:00,Buy REN,REN,710,,,EUR,100,100,crypto_purchase,ren1\n" +
      "2025-01-02 10:00:00,Balance Conversion,REN,-710,,,EUR,42,48,crypto_wallet_swap_debited,swap-d\n" +
      "2025-01-02 10:00:00,Balance Conversion,USDC,47.57,,,EUR,44.54,51,crypto_wallet_swap_credited,swap-c\n";

    const result = parseCryptoComTradesCsv(csv);
    expect(result.rows.map((r) => r.symbol)).toEqual(["USDC"]);
    expect(result.rows[0]).toMatchObject({
      symbol: "USDC",
      quantity: 47.57,
      costCurrency: "EUR",
    });
    expect(result.rows[0]!.costPerUnit).toBeCloseTo(44.54 / 47.57);
    expect(
      result.errors.some((e) => /closed position:\s*ren/i.test(e.message)),
    ).toBe(true);
    expect(
      result.errors.some((e) =>
        /applied withdrawal:\s*710 ren/i.test(e.message),
      ),
    ).toBe(true);
  });

  it("credits admin_wallet crypto so later disposals can net", () => {
    const csv =
      "Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash\n" +
      "2025-01-01 10:00:00,Adjustment,ETHW,1.61,,,EUR,10,12,admin_wallet_credited,adj1\n" +
      "2025-01-02 10:00:00,ETHW > USDC,ETHW,-1.61,USDC,2.3,EUR,2.3,2.5,crypto_exchange,ex1\n";

    const result = parseCryptoComTradesCsv(csv);
    expect(result.rows.map((r) => r.symbol)).toEqual(["USDC"]);
    expect(
      result.errors.some((e) => /sell exceeded/i.test(e.message)),
    ).toBe(false);
    expect(
      result.errors.some((e) => /closed position:\s*ethw/i.test(e.message)),
    ).toBe(true);
  });

  it("parses Exchange spot trades and nets sells FIFO", () => {
    const result = parseCryptoComTradesCsv(
      readFileSync(exchangeFixture, "utf8"),
    );

    expect(result.rows).toHaveLength(2);
    const btc = result.rows.find((r) => r.symbol === "BTC");
    expect(btc).toMatchObject({
      symbol: "BTC",
      quantity: 0.01,
      costPerUnit: 90000,
      costCurrency: "USDT",
      purchasedAt: "2025-02-20",
    });
    expect(btc!.fees).toBeCloseTo(0.45);
    expect(result.rows.find((r) => r.symbol === "ETH")).toMatchObject({
      symbol: "ETH",
      quantity: 0.25,
      costPerUnit: 3000,
      costCurrency: "EUR",
      fees: 0.75,
    });
    expect(
      result.errors.some((e) => /applied sell/i.test(e.message)),
    ).toBe(true);
  });

  it("returns errors for empty or unknown CSV", () => {
    expect(parseCryptoComTradesCsv("   ").rows).toEqual([]);
    expect(parseCryptoComTradesCsv("Foo,Bar\n1,2\n").rows).toEqual([]);
  });
});
