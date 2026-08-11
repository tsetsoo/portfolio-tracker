import Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@/lib/db/migrate";
import {
  getDailyFxRate,
  prefetchCryptoEurDailyRates,
  prefetchUsdEurDailyRates,
  upsertDailyFxRate,
} from "@/lib/import/fx-daily";

describe("fx-daily", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
  });
  afterEach(() => db.close());

  it("round-trips a daily rate", () => {
    upsertDailyFxRate(db, "USD", "EUR", "2022-04-21", 0.92);
    expect(getDailyFxRate(db, "USD", "EUR", "2022-04-21")).toBe(0.92);
    expect(getDailyFxRate(db, "USDT", "EUR", "2022-04-21")).toBe(0.92); // alias
  });

  it("prefetches missing USD→EUR dates via Frankfurter", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ rates: { EUR: 0.91 } }), { status: 200 }),
    );
    const result = await prefetchUsdEurDailyRates(
      db,
      ["2022-04-21", "2022-04-21"],
      fetchImpl,
    );
    expect(result.fetched).toBe(1);
    expect(result.failed).toEqual([]);
    expect(getDailyFxRate(db, "USD", "EUR", "2022-04-21")).toBe(0.91);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("continues fetching later dates after an earlier date fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rates: { EUR: 0.93 } }), {
          status: 200,
        }),
      );

    const result = await prefetchUsdEurDailyRates(
      db,
      ["2022-04-21", "2022-04-22"],
      fetchImpl,
    );

    expect(result.fetched).toBe(1);
    expect(result.failed).toEqual(["2022-04-21"]);
    expect(getDailyFxRate(db, "USD", "EUR", "2022-04-21")).toBeNull();
    expect(getDailyFxRate(db, "USD", "EUR", "2022-04-22")).toBe(0.93);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("prefetches crypto→EUR via Binance EUR klines", async () => {
    const open = Date.parse("2022-08-20T00:00:00.000Z");
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("BNBEUR") && url.includes("klines")) {
        return new Response(
          JSON.stringify([
            [open, "1", "1", "1", "250.5", "1", open + 1, "1", 1, "1", "1", "0"],
          ]),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 400 });
    });

    const result = await prefetchCryptoEurDailyRates(
      db,
      [{ symbol: "BNB", date: "2022-08-20" }],
      fetchImpl,
      { pauseMs: 0 },
    );

    expect(result.fetched).toBe(1);
    expect(result.failed).toEqual([]);
    expect(getDailyFxRate(db, "BNB", "EUR", "2022-08-20")).toBe(250.5);
  });
});
