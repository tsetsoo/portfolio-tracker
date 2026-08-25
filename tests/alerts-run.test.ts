import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquirePassLock } from "@/lib/alerts/pass-lock";
import { createAlert, getAlert, setAlertEnabled } from "@/lib/alerts/repo";
import { runAlerts, runAlertsNow } from "@/lib/alerts/run";
import type { AlertNotifier } from "@/lib/alerts/telegram";
import { migrate } from "@/lib/db/migrate";
import type { Quote, QuoteService } from "@/lib/quotes/types";

// runAlertsNow() is wired to the real getDb() singleton; swap it for a ref
// this file controls so the lock-guarding tests below can point it at the
// same in-memory database the other tests use, without touching a real file.
const dbRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/client", () => ({
  getDb: () => dbRef.current,
}));

const NOW = new Date("2026-08-21T12:00:00.000Z");

function fresh(price: number, currency = "EUR"): Quote {
  return { price, currency, stale: false, fetchedAt: NOW.toISOString() };
}

/** Quote service backed by a fixed map; records how it was called. */
function fakeQuotes(prices: Record<string, Quote>) {
  const cryptoCalls: { symbols: string[]; preferredCurrency?: string }[] = [];
  const equityCalls: { symbol: string; preferredCurrency?: string }[] = [];
  const service: QuoteService = {
    async getQuote(symbol, _assetClass, opts) {
      equityCalls.push({
        symbol,
        preferredCurrency: opts?.preferredCurrency,
      });
      const quote = prices[symbol];
      if (!quote) throw new Error(`no quote for ${symbol}`);
      return quote;
    },
    async getCryptoQuotes(symbols, opts) {
      cryptoCalls.push({
        symbols: [...symbols],
        preferredCurrency: opts?.preferredCurrency,
      });
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

    // All three alerts above are EUR (thresholdAlert's default), so grouping
    // by currency still yields exactly one batched call.
    expect(cryptoCalls).toHaveLength(1);
    expect([...cryptoCalls[0]!.symbols].sort()).toEqual(["BTC", "ETH"]);
    expect(cryptoCalls[0]!.preferredCurrency).toBe("EUR");
  });

  it("groups crypto alerts by currency into one quote call per currency, keying results so same-symbol alerts in different currencies each get their own quote", async () => {
    const btcUsd = createAlert(db, {
      symbol: "BTC",
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: 100_000,
      anchorPrice: 90_000,
      currency: "USD",
    });
    const btcEur = createAlert(db, {
      symbol: "BTC",
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: 100_000,
      anchorPrice: 90_000,
      currency: "EUR",
    });
    const ethUsd = createAlert(db, {
      symbol: "ETH",
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: 5_000,
      anchorPrice: 4_000,
      currency: "USD",
    });

    const cryptoCalls: { symbols: string[]; preferredCurrency?: string }[] =
      [];
    const service: QuoteService = {
      async getQuote() {
        throw new Error("not used in this test");
      },
      async getCryptoQuotes(symbols, opts) {
        cryptoCalls.push({
          symbols: [...symbols],
          preferredCurrency: opts?.preferredCurrency,
        });
        const map = new Map<string, Quote>();
        for (const symbol of symbols) {
          if (opts?.preferredCurrency === "USD" && symbol === "BTC") {
            map.set(symbol, fresh(65_000, "USD"));
          } else if (opts?.preferredCurrency === "USD" && symbol === "ETH") {
            map.set(symbol, fresh(3_500, "USD"));
          } else if (opts?.preferredCurrency === "EUR" && symbol === "BTC") {
            map.set(symbol, fresh(60_000, "EUR"));
          }
        }
        return map;
      },
      async getFxRate() {
        return { rate: 1, stale: false };
      },
    };

    const result = await runAlerts({
      db,
      quotes: service,
      notifier: fakeNotifier(),
      now: NOW,
    });

    // Two alerts in USD plus one in EUR is two requests, not three.
    expect(cryptoCalls).toHaveLength(2);
    expect(cryptoCalls.map((c) => c.preferredCurrency).sort()).toEqual([
      "EUR",
      "USD",
    ]);
    const usdCall = cryptoCalls.find((c) => c.preferredCurrency === "USD");
    expect([...usdCall!.symbols].sort()).toEqual(["BTC", "ETH"]);
    const eurCall = cryptoCalls.find((c) => c.preferredCurrency === "EUR");
    expect(eurCall!.symbols).toEqual(["BTC"]);

    // None of the targets are crossed, so each alert's own quote (not a
    // cross-currency one) lands on last_price.
    expect(result).toEqual({ checked: 3, fired: 0, errors: 0 });
    expect(getAlert(db, btcUsd.id)?.lastPrice).toBe(65_000);
    expect(getAlert(db, btcEur.id)?.lastPrice).toBe(60_000);
    expect(getAlert(db, ethUsd.id)?.lastPrice).toBe(3_500);
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

  it("records an error instead of evaluating a non-positive quote price", async () => {
    // A percent alert would otherwise compute this as a -100% move, fire,
    // and re-anchor to the same non-positive price — stranding it on
    // "missing-anchor" forever (repo.ts's recordFire guard is the second
    // line of defence; this is the first, at the source).
    const alert = createAlert(db, {
      symbol: "ETH",
      assetClass: "crypto",
      kind: "percent_move",
      direction: "either",
      percent: 0.05,
      anchorPrice: 3_000,
      currency: "EUR",
    });
    const { service } = fakeQuotes({ ETH: fresh(0) });
    const notifier = fakeNotifier();

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    expect(result).toEqual({ checked: 1, fired: 0, errors: 1 });
    expect(notifier.sent).toEqual([]);
    const after = getAlert(db, alert.id);
    expect(after?.lastError).toContain("Invalid price");
    expect(after?.anchorPrice).toBe(3_000);
    expect(after?.lastFiredAt).toBeNull();
  });

  it("does not overwrite last_price with a mismatched-currency quote", async () => {
    // The quote's currency does not match the alert's frozen currency:
    // evaluateAlert already knows the number is not trustworthy in the
    // alert's currency, so it must not be displayed as if it were.
    const alert = createAlert(db, {
      symbol: "AAPL",
      assetClass: "equity",
      kind: "threshold",
      direction: "above",
      targetPrice: 500,
      anchorPrice: 150,
      currency: "EUR",
    });
    // Seed a known-good previous price the mismatch pass must not clobber.
    const { service: firstService } = fakeQuotes({ AAPL: fresh(160, "EUR") });
    await runAlerts({
      db,
      quotes: firstService,
      notifier: fakeNotifier(),
      now: NOW,
    });
    expect(getAlert(db, alert.id)?.lastPrice).toBe(160);

    const { service } = fakeQuotes({ AAPL: fresh(300, "USD") });
    const notifier = fakeNotifier();
    const later = new Date(NOW.getTime() + 60_000);

    const result = await runAlerts({ db, quotes: service, notifier, now: later });

    expect(result).toEqual({ checked: 1, fired: 0, errors: 1 });
    expect(notifier.sent).toEqual([]);
    const after = getAlert(db, alert.id);
    expect(after?.lastError).toContain("currency");
    // The previous known-good price survives; the USD 300 quote is never
    // written under the alert's EUR currency.
    expect(after?.lastPrice).toBe(160);
  });

  it("does not overwrite last_price with a quote that is both stale and mismatched-currency", async () => {
    // evaluateAlert checks staleness before currency, so a quote that is
    // both stale and in the wrong currency comes back as "stale-quote", not
    // "currency-mismatch". The write-guard in run.ts must key off the
    // quote's actual currency, not the decision code, or this quote's price
    // slips through the currency-mismatch fix and still lands on last_price.
    const alert = createAlert(db, {
      symbol: "AAPL",
      assetClass: "equity",
      kind: "threshold",
      direction: "above",
      targetPrice: 500,
      anchorPrice: 150,
      currency: "EUR",
    });
    const { service: firstService } = fakeQuotes({ AAPL: fresh(160, "EUR") });
    await runAlerts({
      db,
      quotes: firstService,
      notifier: fakeNotifier(),
      now: NOW,
    });
    expect(getAlert(db, alert.id)?.lastPrice).toBe(160);

    const { service } = fakeQuotes({
      AAPL: { ...fresh(300, "USD"), stale: true },
    });
    const notifier = fakeNotifier();
    const later = new Date(NOW.getTime() + 60_000);

    const result = await runAlerts({ db, quotes: service, notifier, now: later });

    expect(result).toEqual({ checked: 1, fired: 0, errors: 1 });
    expect(notifier.sent).toEqual([]);
    const after = getAlert(db, alert.id);
    expect(after?.lastError).toContain("stale");
    // The previous known-good price survives; the stale USD 300 quote is
    // never written under the alert's EUR currency.
    expect(after?.lastPrice).toBe(160);
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
    createAlert(db, {
      symbol: "MSFT",
      assetClass: "equity",
      kind: "threshold",
      direction: "below",
      targetPrice: 400,
      anchorPrice: 420,
      currency: "USD",
    });
    const disabled = thresholdAlert("BTC", 1);
    setAlertEnabled(db, disabled.id, false);

    const { service, equityCalls, cryptoCalls } = fakeQuotes({
      AAPL: fresh(140),
      MSFT: fresh(300, "USD"),
      BTC: fresh(105_240),
    });
    const notifier = fakeNotifier();

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    // The disabled BTC alert is never priced and never sends, and each equity
    // is priced in the currency stored on its own alert.
    expect(equityCalls).toEqual([
      { symbol: "AAPL", preferredCurrency: "EUR" },
      { symbol: "MSFT", preferredCurrency: "USD" },
    ]);
    expect(cryptoCalls).toEqual([]);
    expect(result.checked).toBe(2);
    expect(result.fired).toBe(2);
    expect(notifier.sent).toHaveLength(2);
    expect(getAlert(db, disabled.id)?.lastCheckedAt).toBeNull();
  });

  it("persists the new anchor from the decision when a percent alert fires", async () => {
    const alert = createAlert(db, {
      symbol: "ETH",
      assetClass: "crypto",
      kind: "percent_move",
      direction: "either",
      percent: 0.05,
      anchorPrice: 3_000,
      currency: "EUR",
    });
    const { service } = fakeQuotes({ ETH: fresh(3_300) });
    const notifier = fakeNotifier();

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    expect(result).toEqual({ checked: 1, fired: 1, errors: 0 });
    // The seam: evaluate returns nextAnchorPrice, run.ts hands it to recordFire.
    const after = getAlert(db, alert.id);
    expect(after?.anchorPrice).toBe(3_300);
    expect(after?.anchorAt).toBe(NOW.toISOString());

    // Proof the re-anchor took effect: the same price is no longer a 5% move
    // (well past the cooldown, so only the anchor can hold it back).
    const later = new Date(NOW.getTime() + 10 * 24 * 60 * 60_000);
    const second = await runAlerts({
      db,
      quotes: service,
      notifier,
      now: later,
    });
    expect(second).toEqual({ checked: 1, fired: 0, errors: 0 });
  });

  it("leaves a threshold alert's anchor alone when it fires", async () => {
    const alert = thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({ BTC: fresh(105_240) });

    await runAlerts({ db, quotes: service, notifier: fakeNotifier(), now: NOW });

    expect(getAlert(db, alert.id)?.anchorPrice).toBe(90_000);
  });
});

describe("runAlertsNow", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
    dbRef.current = db;
    // Neither var is set in the test environment, so runAlerts() below
    // always sees notifier: null and returns before touching quotes —
    // exactly what these tests need, since they only care about the lock.
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  afterEach(() => {
    db.close();
    dbRef.current = null;
  });

  it("reports already-running, and leaves the lock alone, when another holder's lease is current", async () => {
    // runAlertsNow() checks the lock against the real clock (it takes no
    // injectable `now`), so the lease claimed here must be current against
    // that, not against the fixed NOW used elsewhere in this file.
    acquirePassLock(db, new Date());

    const result = await runAlertsNow();

    expect(result).toEqual({
      checked: 0,
      fired: 0,
      errors: 0,
      skipped: "already-running",
    });
    // Still held: a call that lost the race must not release a lock it
    // never acquired.
    const stillLocked = db
      .prepare(`SELECT locked_until FROM alert_pass_lock WHERE id = 1`)
      .get() as { locked_until: string | null };
    expect(stillLocked.locked_until).not.toBeNull();
  });

  it("wires a timeout-bearing fetch into both the quote service and the notifier", async () => {
    // A hung socket must not be able to outlive the pass's own lease (see
    // REQUEST_TIMEOUT_MS in lib/alerts/run.ts). Prove the wiring end to
    // end: every fetch call the pass makes — CoinGecko for the quote, then
    // Telegram for the send this crossed threshold triggers — carries an
    // AbortSignal, without actually waiting out a timeout.
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_CHAT_ID = "4242";
    createAlert(db, {
      symbol: "BTC",
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: 100_000,
      anchorPrice: 90_000,
      currency: "EUR",
    });
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      signals.push(init?.signal);
      if (String(url).includes("coingecko")) {
        return new Response(
          JSON.stringify({ bitcoin: { eur: 105_000, usd: 115_000 } }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    try {
      const result = await runAlertsNow();

      expect(result).toEqual({ checked: 1, fired: 1, errors: 0 });
      // Both the CoinGecko quote request and the Telegram send went through
      // the wrapped fetch.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(signals).toHaveLength(2);
      for (const signal of signals) {
        expect(signal).toBeInstanceOf(AbortSignal);
      }
    } finally {
      vi.unstubAllGlobals();
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;
    }
  });

  it("acquires the lock for the pass and releases it once the pass settles", async () => {
    const result = await runAlertsNow();

    expect(result).toEqual({
      checked: 0,
      fired: 0,
      errors: 0,
      skipped: "telegram-not-configured",
    });
    // The lock must be free again so the next tick is not wedged behind a
    // pass that already finished.
    const freedAgain = acquirePassLock(db, new Date(NOW.getTime() + 1));
    expect(freedAgain).not.toBeNull();
  });
});
