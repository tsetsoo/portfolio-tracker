import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseIbkrTradesCsv } from "@/lib/ibkr/parse";

const fixturePath = path.join(
  __dirname,
  "fixtures",
  "ibkr-trades-sample.csv",
);

describe("parseIbkrTradesCsv", () => {
  it("parses buy rows and nets sells FIFO from the IBKR trades fixture", () => {
    const csv = readFileSync(fixturePath, "utf8");
    const result = parseIbkrTradesCsv(csv);

    // AAPL: buy 10 then sell 3 → 7 remaining; fees prorated 1 * 7/10
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      symbol: "AAPL",
      quantity: 7,
      costPerUnit: 150.25,
      costCurrency: "USD",
      purchasedAt: "2025-07-15",
      fees: 0.7,
      externalTradeId: "TR-1001",
    });
    expect(result.rows[1]).toEqual({
      symbol: "MSFT",
      quantity: 5,
      costPerUnit: 420,
      costCurrency: "USD",
      purchasedAt: "2025-07-16",
      fees: 0.75,
      externalTradeId: "TR-1002",
    });
  });

  it("records applied sells and bad rows in errors", () => {
    const csv = readFileSync(fixturePath, "utf8");
    const result = parseIbkrTradesCsv(csv);

    expect(
      result.errors.some(
        (e) => /applied sell/i.test(e.message) && e.line === 4,
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (e) =>
          e.line === 5 &&
          (e.message.toLowerCase().includes("quantity") ||
            e.message.toLowerCase().includes("invalid")),
      ),
    ).toBe(true);
  });

  it("drops fully sold symbols and keeps remaining open lots", () => {
    const csv =
      "Symbol,Quantity,T. Price,Currency,DateTime,Comm/Fee,TransactionID\n" +
      "AAPL,10,150.00,USD,2025-01-01 10:00:00,-1.00,TR-B1\n" +
      "MSFT,5,400.00,USD,2025-01-02 10:00:00,-0.50,TR-B2\n" +
      "AAPL,-10,160.00,USD,2025-01-03 10:00:00,-1.00,TR-S1\n" +
      "MSFT,-2,410.00,USD,2025-01-04 10:00:00,-0.25,TR-S2\n";

    const result = parseIbkrTradesCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "MSFT",
      quantity: 3,
      costPerUnit: 400,
      purchasedAt: "2025-01-02",
    });
    expect(result.rows[0].fees).toBeCloseTo(0.3);
    expect(
      result.errors.some((e) => /closed position:\s*aapl/i.test(e.message)),
    ).toBe(true);
    expect(
      result.errors.some((e) => /applied sell:\s*2 msft/i.test(e.message)),
    ).toBe(true);
  });

  it("applies sells FIFO across multiple lots in chronological order", () => {
    // Newest-first CSV — must sort before FIFO
    const csv =
      "Symbol,Quantity,T. Price,Currency,DateTime,Comm/Fee,Buy/Sell,TransactionID\n" +
      "AAPL,-15,120.00,USD,2025-01-03 12:00:00,-1.00,Sell,TR-S1\n" +
      "AAPL,20,110.00,USD,2025-01-02 12:00:00,-0.20,Buy,TR-B2\n" +
      "AAPL,10,100.00,USD,2025-01-01 12:00:00,-0.10,Buy,TR-B1\n";

    const result = parseIbkrTradesCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "AAPL",
      quantity: 15,
      costPerUnit: 110,
      purchasedAt: "2025-01-02",
      externalTradeId: "TR-B2",
    });
    // First lot fully consumed; second lot sold 5 of 20 → fees 0.20 * 15/20
    expect(result.rows[0].fees).toBeCloseTo(0.15);
  });

  it("nets Sell transaction-type rows from Transaction History", () => {
    const csv =
      "Statement,Header,Field Name,Field Value\n" +
      "Statement,Data,Title,Transaction History\n" +
      "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount\n" +
      "Transaction History,Data,2026-01-01,U1,APPLE INC,Buy,AAPL,10.0,150.0,USD,-1500.0,-1.0,-1501.0\n" +
      "Transaction History,Data,2026-01-02,U1,APPLE INC,Sell,AAPL,-4.0,160.0,USD,640.0,-1.0,639.0\n" +
      "Transaction History,Data,2026-01-03,U1,Electronic Fund Transfer,Deposit,-,-,-,-,100.0,-,100.0\n";

    const result = parseIbkrTradesCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "AAPL",
      quantity: 6,
      costPerUnit: 150,
      costCurrency: "USD",
      purchasedAt: "2026-01-01",
    });
    expect(result.rows[0].fees).toBeCloseTo(0.6);
    expect(
      result.errors.some((e) => /applied sell:\s*4 aapl/i.test(e.message)),
    ).toBe(true);
    expect(
      result.errors.some((e) =>
        /deposit|dividend|forex|adjustment/i.test(e.message),
      ),
    ).toBe(false);
  });

  it("returns errors and no rows for empty input", () => {
    const result = parseIbkrTradesCsv("   \n\n  ");
    expect(result.rows).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns errors when required trade columns are missing", () => {
    const result = parseIbkrTradesCsv("Foo,Bar\n1,2\n");
    expect(result.rows).toEqual([]);
    expect(
      result.errors.some((e) =>
        e.message.toLowerCase().includes("header"),
      ),
    ).toBe(true);
  });

  it("defaults fees to 0 for a blank commission column", () => {
    const csv =
      "Symbol,Quantity,T. Price,Currency,DateTime,Comm/Fee,TransactionID\n" +
      "NFLX,2,500.00,USD,2025-07-20 10:00:00,,TR-2001\n";

    const result = parseIbkrTradesCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "NFLX",
      fees: 0,
    });
  });

  it("parses Buy rows from an IBKR Transaction History statement CSV", () => {
    const csv = readFileSync(
      path.join(__dirname, "fixtures", "ibkr-transaction-history-sample.csv"),
      "utf8",
    );
    const result = parseIbkrTradesCsv(csv);

    expect(result.rows).toEqual([
      {
        symbol: "ANAU",
        quantity: 87,
        costPerUnit: 22.365,
        costCurrency: "EUR",
        purchasedAt: "2026-07-16",
        fees: 3.75,
        externalTradeId: null,
      },
      {
        symbol: "GRID",
        quantity: 17,
        costPerUnit: 58.39,
        costCurrency: "EUR",
        purchasedAt: "2026-05-26",
        fees: 0,
        externalTradeId: null,
      },
      {
        symbol: "VRT",
        quantity: 1,
        costPerUnit: 322.54,
        costCurrency: "USD",
        purchasedAt: "2026-07-01",
        fees: 0.8789,
        externalTradeId: null,
      },
    ]);
    // Orphan Sell of AAPL (no prior buy in this export) → exceeded open qty note
    expect(
      result.errors.some((e) =>
        /sell exceeded open quantity for aapl/i.test(e.message),
      ),
    ).toBe(true);
    expect(
      result.errors.some((e) =>
        /deposit|dividend|forex|adjustment/i.test(e.message),
      ),
    ).toBe(false);
  });
});
