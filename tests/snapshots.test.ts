import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrate } from "@/lib/db/migrate";
import type { PortfolioValuation } from "@/lib/domain/types";
import {
  ensureTodaySnapshot,
  listSnapshots,
} from "@/lib/portfolio/snapshots";
import { getSettings, setBaseCurrency } from "@/lib/settings";

const databases: Database.Database[] = [];

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("settings", () => {
  it("reads and updates the base currency", () => {
    const db = makeDb();

    expect(getSettings(db)).toEqual({ id: 1, baseCurrency: "EUR" });

    setBaseCurrency(db, "usd");

    expect(getSettings(db)).toEqual({ id: 1, baseCurrency: "USD" });
  });
});

describe("snapshots", () => {
  const valuation: PortfolioValuation = {
    baseCurrency: "EUR",
    totalBase: 1250,
    totalCostBase: 1000,
    unrealizedPlBase: 250,
    holdings: [],
    pricesOutdated: false,
    asOf: "2026-07-25T12:00:00.000Z",
  };

  it("writes a snapshot only once per date", () => {
    const db = makeDb();

    expect(ensureTodaySnapshot(db, valuation, "2026-07-25")).toBe(true);
    expect(
      ensureTodaySnapshot(
        db,
        { ...valuation, totalBase: 9999 },
        "2026-07-25",
      ),
    ).toBe(false);

    expect(listSnapshots(db)).toEqual([
      { date: "2026-07-25", totalBase: 1250 },
    ]);
  });

  it("lists snapshots in date order", () => {
    const db = makeDb();

    ensureTodaySnapshot(db, valuation, "2026-07-26");
    ensureTodaySnapshot(
      db,
      { ...valuation, totalBase: 1100 },
      "2026-07-24",
    );

    expect(listSnapshots(db)).toEqual([
      { date: "2026-07-24", totalBase: 1100 },
      { date: "2026-07-26", totalBase: 1250 },
    ]);
  });
});
