import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Quote, QuoteService } from "@/lib/quotes/types";

// createAlertAction reaches getDb() and createQuoteService() as module-level
// imports; swap both for fakes this file controls so tests never touch a
// real file or a real provider.
const dbRef = vi.hoisted(() => ({ current: null as unknown }));
const quoteServiceRef = vi.hoisted(() => ({
  current: null as QuoteService | null,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => dbRef.current,
}));

vi.mock("@/lib/quotes/service", () => ({
  createQuoteService: () => quoteServiceRef.current,
}));

import { createAlertAction, type CreateAlertInput } from "@/app/actions/alerts";
import { listAlerts } from "@/lib/alerts/repo";
import { migrate } from "@/lib/db/migrate";

function fresh(price: number, currency = "EUR"): Quote {
  return { price, currency, stale: false, fetchedAt: "2026-08-22T00:00:00.000Z" };
}

/** Quote service backed by a fixed map; every symbol resolves to the same quote. */
function quotesReturning(quote: Quote): QuoteService {
  return {
    async getQuote() {
      return quote;
    },
    async getCryptoQuotes(symbols) {
      const map = new Map<string, Quote>();
      for (const symbol of symbols) map.set(symbol, quote);
      return map;
    },
    async getFxRate() {
      return { rate: 1, stale: false };
    },
  };
}

function baseInput(overrides: Partial<CreateAlertInput> = {}): CreateAlertInput {
  return {
    symbol: "BTC",
    assetClass: "crypto",
    kind: "threshold",
    direction: "above",
    targetPrice: 100_000,
    ...overrides,
  };
}

describe("createAlertAction", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
    dbRef.current = db;
    quoteServiceRef.current = quotesReturning(fresh(96_400));
  });

  afterEach(() => {
    db.close();
    dbRef.current = null;
    quoteServiceRef.current = null;
  });

  it("rejects a threshold alert whose direction is not above/below, before pricing", async () => {
    const calls: string[] = [];
    quoteServiceRef.current = {
      async getQuote() {
        calls.push("getQuote");
        return fresh(96_400);
      },
      async getCryptoQuotes(symbols) {
        calls.push("getCryptoQuotes");
        return new Map(symbols.map((s) => [s, fresh(96_400)]));
      },
      async getFxRate() {
        return { rate: 1, stale: false };
      },
    };

    const result = await createAlertAction(
      baseInput({ direction: "up" as CreateAlertInput["direction"] }),
    );

    expect(result).toEqual({
      ok: false,
      error: 'A threshold alert needs direction "above" or "below"',
    });
    // The point of validating up front: an invalid pairing never burns a
    // rate-limited quote request.
    expect(calls).toEqual([]);
    expect(listAlerts(db)).toEqual([]);
  });

  it("rejects a percent alert whose direction is not up/down/either, before pricing", async () => {
    const calls: string[] = [];
    quoteServiceRef.current = {
      async getQuote() {
        calls.push("getQuote");
        return fresh(96_400);
      },
      async getCryptoQuotes(symbols) {
        calls.push("getCryptoQuotes");
        return new Map(symbols.map((s) => [s, fresh(96_400)]));
      },
      async getFxRate() {
        return { rate: 1, stale: false };
      },
    };

    const result = await createAlertAction(
      baseInput({
        kind: "percent_move",
        direction: "above" as CreateAlertInput["direction"],
        targetPrice: undefined,
        percentWhole: 5,
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: 'A percent alert needs direction "up", "down", or "either"',
    });
    expect(calls).toEqual([]);
    expect(listAlerts(db)).toEqual([]);
  });

  it("accepts every valid threshold and percent direction pairing", async () => {
    for (const direction of ["above", "below"] as const) {
      const result = await createAlertAction(baseInput({ direction }));
      expect(result).toEqual({ ok: true });
    }
    for (const direction of ["up", "down", "either"] as const) {
      const result = await createAlertAction(
        baseInput({
          kind: "percent_move",
          direction,
          targetPrice: undefined,
          percentWhole: 5,
        }),
      );
      expect(result).toEqual({ ok: true });
    }
    expect(listAlerts(db)).toHaveLength(5);
  });

  it("rejects creating an alert when the crypto quote came back stale", async () => {
    quoteServiceRef.current = quotesReturning({ ...fresh(96_400), stale: true });

    const result = await createAlertAction(baseInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/could not be refreshed/i);
      expect(result.error).toContain("BTC");
    }
    // Not anchored on the stale price: no alert was created at all.
    expect(listAlerts(db)).toEqual([]);
  });

  it("rejects creating an alert when the equity quote came back stale", async () => {
    // Requested currency defaults to the portfolio base (EUR): the quote
    // must match that so this test exercises the staleness check, not the
    // separate currency-mismatch rejection in resolveAlertSymbol.
    quoteServiceRef.current = quotesReturning({
      ...fresh(180, "EUR"),
      stale: true,
    });

    const result = await createAlertAction(
      baseInput({ symbol: "AAPL", assetClass: "equity" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/could not be refreshed/i);
      expect(result.error).toContain("AAPL");
    }
    expect(listAlerts(db)).toEqual([]);
  });

  it("creates the alert when the quote is fresh", async () => {
    quoteServiceRef.current = quotesReturning(fresh(96_400));

    const result = await createAlertAction(baseInput());

    expect(result).toEqual({ ok: true });
    expect(listAlerts(db)).toHaveLength(1);
  });
});
