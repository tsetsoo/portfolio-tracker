import { describe, expect, it } from "vitest";

import { resolveAlertSymbol } from "@/lib/alerts/resolve-symbol";
import type { Quote, QuoteService } from "@/lib/quotes/types";

function quotes(prices: Record<string, Quote>): QuoteService {
  return {
    async getQuote(symbol) {
      const quote = prices[symbol];
      if (!quote) throw new Error(`Yahoo request failed (404)`);
      return quote;
    },
    async getCryptoQuotes(symbols) {
      const map = new Map<string, Quote>();
      for (const symbol of symbols) {
        const quote = prices[symbol];
        if (quote) map.set(symbol, quote);
      }
      return map;
    },
    async getFxRate() {
      return { rate: 1, stale: false };
    },
  };
}

const fresh = (price: number, currency = "EUR"): Quote => ({
  price,
  currency,
  stale: false,
  fetchedAt: "2026-08-21T12:00:00.000Z",
});

describe("resolveAlertSymbol", () => {
  it("resolves a mapped crypto symbol and upper-cases it", async () => {
    const resolved = await resolveAlertSymbol(
      " btc ",
      "crypto",
      "EUR",
      quotes({ BTC: fresh(96_400) }),
    );
    expect(resolved).toEqual({
      symbol: "BTC",
      price: 96_400,
      currency: "EUR",
    });
  });

  it("rejects a crypto symbol missing from the CoinGecko map", async () => {
    await expect(
      resolveAlertSymbol("XYZ", "crypto", "EUR", quotes({})),
    ).rejects.toThrow(/COINGECKO_IDS/);
  });

  it("rejects a mapped crypto symbol with no price available", async () => {
    await expect(
      resolveAlertSymbol("SOL", "crypto", "EUR", quotes({})),
    ).rejects.toThrow(/price/i);
  });

  it("resolves an equity through the quote service and keeps its currency", async () => {
    const resolved = await resolveAlertSymbol(
      "aapl",
      "equity",
      "EUR",
      quotes({ AAPL: fresh(180, "USD") }),
    );
    expect(resolved).toEqual({ symbol: "AAPL", price: 180, currency: "USD" });
  });

  it("surfaces the provider error for an unknown ticker", async () => {
    await expect(
      resolveAlertSymbol("NOPE", "equity", "EUR", quotes({})),
    ).rejects.toThrow(/404/);
  });
});
