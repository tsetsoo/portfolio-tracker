import Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@/lib/db/migrate";
import {
  getDailyFxRate,
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
});
