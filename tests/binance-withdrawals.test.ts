import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseBinanceUnifiedWithdraw } from "@/lib/binance/parse";
import { extractBinanceWithdrawals } from "@/lib/binance/withdrawals";
import { createFifoFxLookup } from "@/lib/import/fifo-net";

const fixture = path.join(
  __dirname,
  "fixtures",
  "binance-withdraw-sample.csv",
);

describe("extractBinanceWithdrawals", () => {
  it("parses Completed rows with TxID and fee-inclusive FIFO qty", () => {
    const csv = readFileSync(fixture, "utf8");
    const rows = extractBinanceWithdrawals(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      chain: "btc",
      asset: "BTC",
      amount: 0.12303447,
      fee: 0.00002,
      fifoQuantity: 0.12305447,
    });
    expect(rows[0]!.txHash).toMatch(/^076b89d6/);
    expect(rows[1]).toMatchObject({
      chain: "eth",
      asset: "ETH",
      amount: 8.46497702,
    });
  });

  it("skips Rejected rows without TxID", () => {
    const csv =
      "Time,Coin,Network,Amount,Fee,Address,TXID,Status\n" +
      "2021-11-20 15:54:15,LINK,ETH,22.216,0.512,0xabc,,Rejected\n";
    expect(extractBinanceWithdrawals(csv)).toEqual([]);
  });
});

describe("parseBinanceUnifiedWithdraw", () => {
  it("FIFO-consumes convert buys with withdraw fills", () => {
    const spot =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n" +
      "2021-03-01 10:00:00,BTCEUR,BUY,40000,0.2BTC,8000EUR,0EUR\n";
    const withdraw = readFileSync(fixture, "utf8");
    const result = parseBinanceUnifiedWithdraw({
      spotCsv: spot,
      withdrawCsv: withdraw,
      fx: createFifoFxLookup({ baseCurrency: "EUR" }),
    });
    expect(result.withdrawals?.length).toBe(2);
    const btcWd = result.withdrawals?.find((w) => w.asset === "BTC");
    expect(btcWd?.costBasis).toBeCloseTo(0.12305447 * 40000, 2);
    expect(btcWd?.costStatus).toBe("costed");
    const btcOpen = result.rows.find((r) => r.symbol === "BTC");
    expect(btcOpen?.quantity).toBeCloseTo(0.2 - 0.12305447, 6);
  });
});
