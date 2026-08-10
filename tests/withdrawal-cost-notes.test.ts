import { describe, expect, it } from "vitest";

import { attachWithdrawalCosts } from "@/lib/cryptocom/parse";

it("writes missing FX currencies into costNotes when partial", () => {
  const rows = attachWithdrawalCosts(
    [
      {
        chain: "btc",
        asset: "BTC",
        amount: 1,
        txHash: "abc",
        transferredAt: "2022-08-20",
      },
    ],
    [
      {
        externalTradeId: "abc",
        asset: "BTC",
        quantity: 1,
        costBasis: 5000,
        costCurrency: "EUR",
        partial: true,
        missingCurrencies: ["CRO"],
      },
    ],
  );
  expect(rows[0]!.costStatus).toBe("partial");
  expect(rows[0]!.costNotes).toContain("CRO");
});

describe("attachWithdrawalCosts", () => {
  it("uses generic note when partial without missing currencies", () => {
    const rows = attachWithdrawalCosts(
      [
        {
          chain: "btc",
          asset: "BTC",
          amount: 1,
          txHash: "abc",
          transferredAt: "2022-08-20",
        },
      ],
      [
        {
          externalTradeId: "abc",
          asset: "BTC",
          quantity: 1,
          costBasis: 5000,
          costCurrency: "EUR",
          partial: true,
        },
      ],
    );
    expect(rows[0]!.costNotes).toBe(
      "Mixed lot currencies; some FX rates missing",
    );
  });
});
