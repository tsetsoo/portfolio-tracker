import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAlert, getAlert, setAlertEnabled } from "@/lib/alerts/repo";
import { runAlerts } from "@/lib/alerts/run";
import type { AlertNotifier } from "@/lib/alerts/telegram";
import { migrate } from "@/lib/db/migrate";
import type { Quote, QuoteService } from "@/lib/quotes/types";

const NOW = new Date("2026-08-21T12:00:00.000Z");

function fresh(price: number, currency = "EUR"): Quote {
  return { price, currency, stale: false, fetchedAt: NOW.toISOString() };
}

/** Quote service backed by a fixed map; records how it was called. */
function fakeQuotes(prices: Record<string, Quote>) {
  const cryptoCalls: string[][] = [];
  const equityCalls: string[] = [];
  const service: QuoteService = {
    async getQuote(symbol) {
      equityCalls.push(symbol);
      const quote = prices[symbol];
      if (!quote) throw new Error(`no quote for ${symbol}`);
      return quote;
    },
    async getCryptoQuotes(symbols) {
      cryptoCalls.push(symbols);
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
  return { service, cryptoCalls, equityCalls };
}

function fakeNotifier(): AlertNotifier & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    async send(text: string) {
      sent.push(text);
    },
  };
}

describe("runAlerts", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  function thresholdAlert(symbol: string, target: number) {
    return createAlert(db, {
      symbol,
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: target,
      anchorPrice: target * 0.9,
      currency: "EUR",
    });
  }

  it("skips the pass entirely when there is no notifier", async () => {
    thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({ BTC: fresh(105_000) });

    const result = await runAlerts({
      db,
      quotes: service,
      notifier: null,
      now: NOW,
    });

    expect(result).toEqual({
      checked: 0,
      fired: 0,
      errors: 0,
      skipped: "telegram-not-configured",
    });
  });

  it("sends one message per fired alert and records the fire", async () => {
    const alert = thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({ BTC: fresh(105_240) });
    const notifier = fakeNotifier();

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    expect(result).toEqual({ checked: 1, fired: 1, errors: 0 });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toContain("BTC");
    const after = getAlert(db, alert.id);
    expect(after?.lastFiredAt).toBe(NOW.toISOString());
    expect(after?.lastPrice).toBe(105_240);
  });

  it("batches every crypto symbol into a single quote call", async () => {
    thresholdAlert("BTC", 100_000);
    thresholdAlert("ETH", 5_000);
    thresholdAlert("BTC", 200_000);
    const { service, cryptoCalls } = fakeQuotes({
      BTC: fresh(105_240),
      ETH: fresh(3_000),
    });

    await runAlerts({ db, quotes: service, notifier: fakeNotifier(), now: NOW });

    expect(cryptoCalls).toHaveLength(1);
    expect([...cryptoCalls[0]].sort()).toEqual(["BTC", "ETH"]);
  });

  it("records a check without firing when the level is not crossed", async () => {
    const alert = thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({ BTC: fresh(97_000) });
    const notifier = fakeNotifier();

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    expect(result).toEqual({ checked: 1, fired: 0, errors: 0 });
    expect(notifier.sent).toEqual([]);
    const after = getAlert(db, alert.id);
    expect(after?.lastCheckedAt).toBe(NOW.toISOString());
    expect(after?.lastFiredAt).toBeNull();
    expect(after?.lastError).toBeNull();
  });

  it("leaves the alert unfired and retryable when the send throws", async () => {
    const alert = thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({ BTC: fresh(105_240) });
    const notifier: AlertNotifier = {
      send: vi.fn(async () => {
        throw new Error("telegram down");
      }),
    };

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    expect(result).toEqual({ checked: 1, fired: 0, errors: 1 });
    const after = getAlert(db, alert.id);
    expect(after?.lastFiredAt).toBeNull();
    expect(after?.lastError).toContain("telegram down");
  });

  it("records an error when no quote comes back", async () => {
    const alert = thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({});

    const result = await runAlerts({
      db,
      quotes: service,
      notifier: fakeNotifier(),
      now: NOW,
    });

    expect(result).toEqual({ checked: 1, fired: 0, errors: 1 });
    const after = getAlert(db, alert.id);
    expect(after?.lastError).toContain("quote");
    expect(after?.enabled).toBe(true);
  });

  it("records an error for a stale quote instead of firing", async () => {
    const alert = thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({
      BTC: { ...fresh(105_240), stale: true },
    });
    const notifier = fakeNotifier();

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    expect(result).toEqual({ checked: 1, fired: 0, errors: 1 });
    expect(notifier.sent).toEqual([]);
    expect(getAlert(db, alert.id)?.lastError).toContain("stale");
  });

  it("ignores disabled alerts and prices equities per alert currency", async () => {
    createAlert(db, {
      symbol: "AAPL",
      assetClass: "equity",
      kind: "threshold",
      direction: "below",
      targetPrice: 150,
      anchorPrice: 180,
      currency: "EUR",
    });
    const disabled = thresholdAlert("BTC", 1);
    setAlertEnabled(db, disabled.id, false);

    const { service, equityCalls, cryptoCalls } = fakeQuotes({
      AAPL: fresh(140),
      BTC: fresh(105_240),
    });
    const notifier = fakeNotifier();

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    // The disabled BTC alert is never priced and never sends.
    expect(equityCalls).toEqual(["AAPL"]);
    expect(cryptoCalls).toEqual([]);
    expect(result.checked).toBe(1);
    expect(result.fired).toBe(1);
    expect(notifier.sent).toHaveLength(1);
    expect(getAlert(db, disabled.id)?.lastCheckedAt).toBeNull();
  });
});
