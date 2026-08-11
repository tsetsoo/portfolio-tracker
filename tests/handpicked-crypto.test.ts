import { describe, expect, it } from "vitest";

import {
  HANDPICKED_OVERVIEW_CRYPTO,
  valueHandpickedCrypto,
} from "@/lib/portfolio/handpicked-crypto";
import type { Quote } from "@/lib/quotes/types";

describe("handpicked overview crypto", () => {
  it("values STX and AVAX with cost, leaves ADA cost unknown", () => {
    const quotes = new Map<string, Quote>([
      [
        "STX",
        {
          price: 0.5,
          currency: "EUR",
          stale: false,
          fetchedAt: "2026-08-11T12:00:00.000Z",
        },
      ],
      [
        "AVAX",
        {
          price: 10,
          currency: "EUR",
          stale: false,
          fetchedAt: "2026-08-11T12:00:00.000Z",
        },
      ],
      [
        "DOT",
        {
          price: 4,
          currency: "EUR",
          stale: false,
          fetchedAt: "2026-08-11T12:00:00.000Z",
        },
      ],
    ]);

    const { holdings, pricesOutdated } = valueHandpickedCrypto(
      HANDPICKED_OVERVIEW_CRYPTO,
      quotes,
      "EUR",
      {},
    );

    expect(pricesOutdated).toBe(false);
    expect(holdings).toHaveLength(3);

    const stx = holdings.find((h) => h.holding.symbol === "STX");
    expect(stx).toMatchObject({
      quantity: 250,
      costBasisBase: 362.08,
      currentValueBase: 125,
      unrealizedPlBase: 125 - 362.08,
    });
    expect(stx?.holding.name).toContain("Crypto.com");

    const avax = holdings.find((h) => h.holding.symbol === "AVAX");
    expect(avax).toMatchObject({
      quantity: 42.89766,
      costBasisBase: 2862.44,
      currentValueBase: 428.9766,
    });
    expect(avax?.holding.name).toContain("Binance");

    const dot = holdings.find((h) => h.holding.symbol === "DOT");
    expect(dot).toMatchObject({
      quantity: 29.9,
      costBasisBase: 120.28,
      currentValueBase: 119.6,
    });
    expect(dot?.holding.name).toMatch(/Polkadot wallet/i);
  });
});
