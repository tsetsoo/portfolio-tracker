import { describe, expect, it, vi } from "vitest";

import { fetchCoinGeckoQuote } from "@/lib/quotes/crypto-coingecko";

/** Residual holdings that were unpriced before explicit CoinGecko IDs. */
const RESIDUAL_CRYPTO_IDS: Record<string, string> = {
  ETHW: "ethereum-pow-iou",
  INJ: "injective-protocol",
  STX: "blockstack",
  USDC: "usd-coin",
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
