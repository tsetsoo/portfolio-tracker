import { describe, expect, it, vi } from "vitest";

import {
  fetchCoinGeckoMarketChartRange,
  fetchCoinGeckoQuote,
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
