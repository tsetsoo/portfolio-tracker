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
      stale: false,
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

  it("resolves an equity through the quote service in the requested currency", async () => {
    const resolved = await resolveAlertSymbol(
      "aapl",
      "equity",
      "USD",
      quotes({ AAPL: fresh(180, "USD") }),
    );
    expect(resolved).toEqual({
      symbol: "AAPL",
      price: 180,
      currency: "USD",
      stale: false,
    });
  });

  it("surfaces the provider error for an unknown ticker", async () => {
    await expect(
      resolveAlertSymbol("NOPE", "equity", "EUR", quotes({})),
    ).rejects.toThrow(/404/);
  });

  it("passes through a stale crypto quote instead of hiding it", async () => {
    // force: true only proves the provider was asked; on a provider failure
    // the quote service still returns a cached row with stale: true. The
    // caller (createAlertAction) needs that flag to refuse anchoring on it.
    const resolved = await resolveAlertSymbol(
      "btc",
      "crypto",
      "EUR",
      quotes({ BTC: { ...fresh(96_400), stale: true } }),
    );
    expect(resolved.stale).toBe(true);
  });

  it("passes through a stale equity quote instead of hiding it", async () => {
    const resolved = await resolveAlertSymbol(
      "aapl",
      "equity",
      "USD",
      quotes({ AAPL: { ...fresh(180, "USD"), stale: true } }),
    );
    expect(resolved.stale).toBe(true);
  });

  it("rejects a quote returned in a different currency than requested", async () => {
    // pickVsPrice (CoinGecko) deliberately degrades to USD when it has no
    // price in the requested currency, and Yahoo can return a listing's
    // native currency; a silently-wrong currency would otherwise be frozen
    // onto the alert forever.
    await expect(
      resolveAlertSymbol("btc", "crypto", "EUR", quotes({ BTC: fresh(96_400, "USD") })),
    ).rejects.toThrow(/currency/i);
  });

  it("resolves a crypto alert requested in USD with a USD anchor price", async () => {
    const usdQuotes: QuoteService = {
      async getQuote() {
        throw new Error("not used for crypto");
      },
      async getCryptoQuotes(symbols, opts) {
        const map = new Map<string, Quote>();
        for (const symbol of symbols) {
          map.set(symbol, fresh(97_000, opts?.preferredCurrency ?? "EUR"));
        }
        return map;
      },
      async getFxRate() {
        return { rate: 1, stale: false };
      },
    };

    const resolved = await resolveAlertSymbol("btc", "crypto", "USD", usdQuotes);

    expect(resolved).toEqual({
      symbol: "BTC",
      price: 97_000,
      currency: "USD",
      stale: false,
    });
  });
});
