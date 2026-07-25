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
  it("parses buy rows from the IBKR trades fixture", () => {
    const csv = readFileSync(fixturePath, "utf8");
    const result = parseIbkrTradesCsv(csv);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      symbol: "AAPL",
      quantity: 10,
      costPerUnit: 150.25,
      costCurrency: "USD",
      purchasedAt: "2025-07-15",
      fees: 1,
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

  it("records skipped sells and bad rows in errors", () => {
    const csv = readFileSync(fixturePath, "utf8");
    const result = parseIbkrTradesCsv(csv);

    expect(
      result.errors.some(
        (e) => e.message.toLowerCase().includes("skipped sell") && e.line === 4,
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
});
