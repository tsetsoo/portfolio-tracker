import { describe, expect, it, vi } from "vitest";

import {
  fetchCoinGeckoMarketChartRange,
  fetchCoinGeckoQuote,
  fetchCoinGeckoQuotes,
  pickPriceOnOrBefore,
} from "@/lib/quotes/crypto-coingecko";

/** Residual holdings that were unpriced before explicit CoinGecko IDs. */
const RESIDUAL_CRYPTO_IDS: Record<string, string> = {
  ETHW: "ethereum-pow-iou",
  INJ: "injective-protocol",
  STX: "blockstack",
  USDC: "usd-coin",
  FTM: "fantom",
};

describe("fetchCoinGeckoQuote residual crypto map", () => {
  for (const [symbol, id] of Object.entries(RESIDUAL_CRYPTO_IDS)) {
    it(`maps ${symbol} → ${id} and returns a EUR quote`, async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ [id]: { eur: 1.23, usd: 1.45 } }),
          { status: 200 },
        ),
      );

      await expect(
        fetchCoinGeckoQuote(symbol, "EUR", fetchImpl),
      ).resolves.toEqual({ price: 1.23, currency: "EUR" });

      expect(fetchImpl).toHaveBeenCalledWith(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=eur,usd`,
      );
    });
  }

  it("rejects unknown crypto symbols", async () => {
    await expect(
      fetchCoinGeckoQuote("NOTACOIN", "EUR", vi.fn<typeof fetch>()),
    ).rejects.toThrow("Unsupported crypto symbol: NOTACOIN");
  });
});

describe("fetchCoinGeckoQuotes", () => {
  it("batches multiple symbols into one request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          bitcoin: { eur: 100_000, usd: 110_000 },
          ethereum: { eur: 3_000, usd: 3_300 },
        }),
        { status: 200 },
      ),
    );

    const quotes = await fetchCoinGeckoQuotes(
      ["BTC", "ETH"],
      "EUR",
      fetchImpl,
    );

    expect(quotes.get("BTC")).toEqual({ price: 100_000, currency: "EUR" });
    expect(quotes.get("ETH")).toEqual({ price: 3_000, currency: "EUR" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      "ids=bitcoin%2Cethereum",
    );
  });

  it("requests the preferred currency plus a usd fallback", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ bitcoin: { gbp: 90_000, usd: 110_000 } }),
        { status: 200 },
      ),
    );

    const quotes = await fetchCoinGeckoQuotes(["BTC"], "GBP", fetchImpl);

    expect(quotes.get("BTC")).toEqual({ price: 90_000, currency: "GBP" });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      "vs_currencies=gbp,usd",
    );
  });

  it("falls back to USD and reports currency USD when CoinGecko has no price in the requested currency", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ bitcoin: { usd: 110_000 } }),
        { status: 200 },
      ),
    );

    const quotes = await fetchCoinGeckoQuotes(["BTC"], "GBP", fetchImpl);

    expect(quotes.get("BTC")).toEqual({ price: 110_000, currency: "USD" });
  });
});

describe("fetchCoinGeckoMarketChartRange", () => {
  it("requests range endpoint and buckets last price per UTC day", async () => {
    const day1 = Date.parse("2022-08-20T12:00:00.000Z");
    const day2 = Date.parse("2022-08-21T12:00:00.000Z");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          prices: [
            [day1, 0.11],
            [day1 + 3600_000, 0.12],
            [day2, 0.13],
          ],
        }),
        { status: 200 },
      ),
    );

    const series = await fetchCoinGeckoMarketChartRange(
      "CRO",
      "EUR",
      "2022-08-20",
      "2022-08-21",
      fetchImpl,
    );
    expect(series).toEqual([
      { date: "2022-08-20", price: 0.12 },
      { date: "2022-08-21", price: 0.13 },
    ]);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      "/coins/crypto-com-chain/market_chart/range?vs_currency=eur&from=",
    );
    expect(pickPriceOnOrBefore(series, "2022-08-20")).toBe(0.12);
    expect(pickPriceOnOrBefore(series, "2022-08-22")).toBe(0.13);
    expect(pickPriceOnOrBefore(series, "2022-08-19")).toBeNull();
  });
});
