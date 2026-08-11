import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrate } from "@/lib/db/migrate";
import { createQuoteService } from "@/lib/quotes/service";

describe("quote service cache", () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
    db = new Database(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it("returns a cached quote within the TTL without fetching", async () => {
    db.prepare(
      `INSERT INTO price_cache
         (symbol, asset_class, price, currency, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("AAPL", "equity", 211.5, "USD", "2026-07-25T11:55:00.000Z");
    const fetchImpl = vi.fn<typeof fetch>();
    const service = createQuoteService(db, fetchImpl);

    await expect(service.getQuote("AAPL", "equity")).resolves.toEqual({
      price: 211.5,
      currency: "USD",
      stale: false,
      fetchedAt: "2026-07-25T11:55:00.000Z",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches and caches a Yahoo equity quote", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                meta: {
                  regularMarketPrice: 212.75,
                  currency: "USD",
                },
              },
            ],
            error: null,
          },
        }),
        { status: 200 },
      ),
    );
    const service = createQuoteService(db, fetchImpl);

    await expect(service.getQuote("aapl", "equity")).resolves.toEqual({
      price: 212.75,
      currency: "USD",
      stale: false,
      fetchedAt: "2026-07-25T12:00:00.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d",
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": "Mozilla/5.0" }),
      }),
    );
    expect(
      db
        .prepare(
          `SELECT price, currency, fetched_at
           FROM price_cache
           WHERE symbol = 'AAPL' AND asset_class = 'equity'`,
        )
        .get(),
    ).toEqual({
      price: 212.75,
      currency: "USD",
      fetched_at: "2026-07-25T12:00:00.000Z",
    });
  });

  it("returns an old cached quote as stale when refresh fails", async () => {
    db.prepare(
      `INSERT INTO price_cache
         (symbol, asset_class, price, currency, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("AAPL", "equity", 199, "USD", "2026-07-25T11:30:00.000Z");
    const service = createQuoteService(
      db,
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    );

    await expect(
      service.getQuote("AAPL", "equity", { force: true }),
    ).resolves.toEqual({
      price: 199,
      currency: "USD",
      stale: true,
      fetchedAt: "2026-07-25T11:30:00.000Z",
    });
  });

  it("fetches crypto in the configured base currency", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          bitcoin: {
            eur: 98_400,
            usd: 115_300,
          },
        }),
        { status: 200 },
      ),
    );
    const service = createQuoteService(db, fetchImpl);

    await expect(service.getQuote("btc", "crypto")).resolves.toMatchObject({
      price: 98_400,
      currency: "EUR",
      stale: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur,usd",
    );
  });

  it("returns cacheOnly quotes without fetching even when past TTL", async () => {
    db.prepare(
      `INSERT INTO price_cache
         (symbol, asset_class, price, currency, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("AAPL", "equity", 200, "USD", "2026-07-25T10:00:00.000Z");
    const fetchImpl = vi.fn<typeof fetch>();
    const service = createQuoteService(db, fetchImpl);

    await expect(
      service.getQuote("AAPL", "equity", { cacheOnly: true }),
    ).resolves.toEqual({
      price: 200,
      currency: "USD",
      stale: true,
      fetchedAt: "2026-07-25T10:00:00.000Z",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("batches crypto quotes into one CoinGecko request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          bitcoin: { eur: 100_000, usd: 110_000 },
          ethereum: { eur: 3_000, usd: 3_300 },
        }),
        { status: 200 },
      ),
    );
    const service = createQuoteService(db, fetchImpl);
    const quotes = await service.getCryptoQuotes(["BTC", "ETH"]);

    expect(quotes.get("BTC")?.price).toBe(100_000);
    expect(quotes.get("ETH")?.price).toBe(3_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fetches and caches an FX rate", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          amount: 1,
          base: "USD",
          date: "2026-07-25",
          rates: { EUR: 0.853 },
        }),
        { status: 200 },
      ),
    );
    const service = createQuoteService(db, fetchImpl);

    await expect(service.getFxRate("usd", "eur")).resolves.toEqual({
      rate: 0.853,
      stale: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.frankfurter.app/latest?from=USD&to=EUR",
    );
    fetchImpl.mockClear();
    await expect(service.getFxRate("USD", "EUR")).resolves.toEqual({
      rate: 0.853,
      stale: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns an old cached FX rate as stale when refresh fails", async () => {
    db.prepare(
      `INSERT INTO fx_rates
         (from_currency, to_currency, rate, fetched_at)
       VALUES (?, ?, ?, ?)`,
    ).run("USD", "EUR", 0.84, "2026-07-25T11:30:00.000Z");
    const service = createQuoteService(
      db,
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    );

    await expect(
      service.getFxRate("USD", "EUR", { force: true }),
    ).resolves.toEqual({
      rate: 0.84,
      stale: true,
    });
  });

  it("throws a provider failure when no cache exists", async () => {
    const service = createQuoteService(
      db,
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("unavailable", { status: 503 }),
      ),
    );

    await expect(service.getQuote("AAPL", "equity")).rejects.toThrow(
      "Yahoo request failed",
    );
  });

  it("does not hide a cache write failure as stale provider data", async () => {
    db.prepare(
      `INSERT INTO price_cache
         (symbol, asset_class, price, currency, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("AAPL", "equity", 199, "USD", "2026-07-25T11:30:00.000Z");
    db.exec(`
      CREATE TRIGGER fail_price_cache_update
      BEFORE UPDATE ON price_cache
      BEGIN
        SELECT RAISE(ABORT, 'cache write failed');
      END
    `);
    const service = createQuoteService(
      db,
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: {
                    regularMarketPrice: 212.75,
                    currency: "USD",
                  },
                },
              ],
              error: null,
            },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(service.getQuote("AAPL", "equity")).rejects.toThrow(
      "cache write failed",
    );
  });

  it("treats USDT as USD for FX conversion", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ rates: { EUR: 0.92 } }), { status: 200 }),
    );
    const service = createQuoteService(db, fetchImpl);

    await expect(service.getFxRate("USDT", "EUR")).resolves.toEqual({
      rate: 0.92,
      stale: false,
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("from=USD");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("to=EUR");
  });

  it("uses cached EUR crypto quotes even when preferredCurrency is a lot quote (USDT)", async () => {
    // Lot quote_currency is often USDT/CRO; CoinGecko caches EUR. Crypto
    // quotes must ignore preferredCurrency so the EUR cache is reusable.
    db.prepare(
      `INSERT INTO price_cache
         (symbol, asset_class, price, currency, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("BTC", "crypto", 98_400, "EUR", "2026-07-25T11:55:00.000Z");

    const fetchImpl = vi.fn<typeof fetch>();
    const service = createQuoteService(db, fetchImpl);

    await expect(
      service.getQuote("BTC", "crypto", { preferredCurrency: "USDT" }),
    ).resolves.toMatchObject({ price: 98_400, currency: "EUR", stale: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores a cached USD quote when EUR is preferred and refetches", async () => {
    db.prepare(
      `INSERT INTO price_cache
         (symbol, asset_class, price, currency, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("GRID", "equity", 177.4, "USD", "2026-07-25T11:55:00.000Z");

    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("GRID.DE")) {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                { meta: { regularMarketPrice: 54.47, currency: "EUR" } },
              ],
              error: null,
            },
          }),
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    });
    const service = createQuoteService(db, fetchImpl);

    await expect(
      service.getQuote("GRID", "equity", { preferredCurrency: "EUR" }),
    ).resolves.toEqual({
      price: 54.47,
      currency: "EUR",
      stale: false,
      fetchedAt: "2026-07-25T12:00:00.000Z",
    });
    expect(
      db
        .prepare(
          `SELECT price, currency FROM price_cache
           WHERE symbol = 'GRID' AND asset_class = 'equity'`,
        )
        .get(),
    ).toEqual({ price: 54.47, currency: "EUR" });
  });
});
