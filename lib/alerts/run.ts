import "server-only";

import type Database from "better-sqlite3";

import { evaluateAlert } from "@/lib/alerts/evaluate";
import { acquirePassLock, releasePassLock } from "@/lib/alerts/pass-lock";
import { listArmedAlerts, recordCheck, recordFire } from "@/lib/alerts/repo";
import {
  createTelegramNotifier,
  formatAlertMessage,
  telegramConfigFromEnv,
  type AlertNotifier,
} from "@/lib/alerts/telegram";
import type { PriceAlert } from "@/lib/alerts/types";
import { getDb } from "@/lib/db/client";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { createQuoteService } from "@/lib/quotes/service";
import type { Quote, QuoteService } from "@/lib/quotes/types";

/**
 * Bounds every outbound request the pass makes (Yahoo, CoinGecko,
 * Telegram) so one hung socket cannot block the pass past its own lease —
 * see DEFAULT_LEASE_MS in lib/alerts/pass-lock.ts. Equity quotes go out
 * sequentially, one request per symbol, and this app expects only a
 * handful of armed alerts at a time, so even a run where every request
 * times out lands comfortably inside the 300s lease at this per-request
 * budget.
 */
const REQUEST_TIMEOUT_MS = 10_000;

export interface RunAlertsResult {
  checked: number;
  fired: number;
  errors: number;
  skipped?: "telegram-not-configured" | "already-running";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Quotes for every armed alert. Crypto goes out as one batched request;
 * equities are one request per symbol+currency pair, memoised so duplicate
 * alerts on the same symbol do not re-fetch.
 */
async function loadQuotes(
  alerts: PriceAlert[],
  quotes: QuoteService,
): Promise<Map<string, Quote>> {
  const byKey = new Map<string, Quote>();

  const cryptoSymbols = [
    ...new Set(
      alerts.filter((a) => a.assetClass === "crypto").map((a) => a.symbol),
    ),
  ];
  if (cryptoSymbols.length > 0) {
    try {
      const fetched = await quotes.getCryptoQuotes(cryptoSymbols);
      for (const [symbol, quote] of fetched) {
        byKey.set(`crypto|${symbol}`, quote);
      }
    } catch {
      // Leave them missing; each alert records "no quote available".
    }
  }

  for (const alert of alerts) {
    if (alert.assetClass !== "equity") continue;
    const key = `equity|${alert.symbol}|${alert.currency}`;
    if (byKey.has(key)) continue;
    try {
      byKey.set(
        key,
        await quotes.getQuote(alert.symbol, "equity", {
          preferredCurrency: alert.currency,
        }),
      );
    } catch {
      // Same as above.
    }
  }

  return byKey;
}

function quoteKey(alert: PriceAlert): string {
  return alert.assetClass === "crypto"
    ? `crypto|${alert.symbol}`
    : `equity|${alert.symbol}|${alert.currency}`;
}

export async function runAlerts(opts: {
  db: Database.Database;
  quotes: QuoteService;
  notifier: AlertNotifier | null;
  now?: Date;
}): Promise<RunAlertsResult> {
  if (!opts.notifier) {
    return {
      checked: 0,
      fired: 0,
      errors: 0,
      skipped: "telegram-not-configured",
    };
  }

  const now = opts.now ?? new Date();
  const checkedAt = now.toISOString();
  const alerts = listArmedAlerts(opts.db);
  if (alerts.length === 0) return { checked: 0, fired: 0, errors: 0 };

  const quotes = await loadQuotes(alerts, opts.quotes);
  let fired = 0;
  let errors = 0;

  for (const alert of alerts) {
    const quote = quotes.get(quoteKey(alert));
    if (!quote) {
      errors += 1;
      recordCheck(opts.db, alert.id, {
        checkedAt,
        price: null,
        error: `No quote available for ${alert.symbol}`,
      });
      continue;
    }

    // A non-positive price is never real: evaluating it would compute a
    // percent alert's move as -100% and, on fire, re-anchor to that same
    // non-positive price, stranding it on "missing-anchor" forever. Treat it
    // as a failed check instead, the same as a missing quote.
    if (!Number.isFinite(quote.price) || quote.price <= 0) {
      errors += 1;
      recordCheck(opts.db, alert.id, {
        checkedAt,
        price: null,
        error: `Invalid price for ${alert.symbol}: ${quote.price}`,
      });
      continue;
    }

    const decision = evaluateAlert(alert, quote, now);

    if (!decision.fires) {
      if (decision.detail) errors += 1;
      // Write the price only when the quote is actually in the alert's
      // frozen currency — never key this off decision.code. evaluateAlert
      // checks staleness before currency, so a quote that is BOTH stale and
      // wrong-currency comes back as "stale-quote", not "currency-mismatch";
      // gating on the code alone would let that number through and render
      // as if it were the alert's own currency. Leave the previous
      // known-good price alone otherwise (recordCheck COALESCEs a null
      // price).
      const quoteCurrency = quote.currency.trim().toUpperCase();
      recordCheck(opts.db, alert.id, {
        checkedAt,
        price: quoteCurrency === alert.currency ? quote.price : null,
        error: decision.detail,
      });
      continue;
    }

    try {
      await opts.notifier.send(formatAlertMessage(alert, quote.price));
    } catch (error) {
      // Do not mark it fired: the next pass retries, so cooldown starts from
      // a message that actually arrived.
      errors += 1;
      recordCheck(opts.db, alert.id, {
        checkedAt,
        price: quote.price,
        error: `Send failed: ${errorMessage(error)}`,
      });
      continue;
    }

    fired += 1;
    recordFire(opts.db, alert.id, {
      firedAt: checkedAt,
      price: quote.price,
      newAnchorPrice: decision.nextAnchorPrice,
    });
  }

  return { checked: alerts.length, fired, errors };
}

/**
 * Wired to the real database, quote service, and env-configured bot.
 *
 * Guards against overlapping passes with a lease lock stored in SQLite
 * (lib/alerts/pass-lock.ts), not an in-process flag. The three entry points
 * that call this — the scheduler tick, the "Check now" server action, and
 * POST /api/alerts/run — are not guaranteed to share this module's JS state:
 * Next compiles instrumentation.ts, route handlers, and server actions into
 * separate webpack layers, so this file (and the `getDb()` singleton it
 * calls) is instantiated once per layer, each with its own module scope. A
 * `let inFlightPass` promise here would only serialise callers that happen
 * to land in the same layer; the other layers would see their own
 * `inFlightPass === null` and start a second pass regardless.
 * `lastFiredAt` is only written after the Telegram send succeeds, so an
 * unnoticed overlapping pass sends the same alert twice. The one thing every
 * layer's copy of this module genuinely shares is the database file, so the
 * lock lives there. A second caller cannot join the pass already running
 * across module instances, so it gets an honest `skipped: "already-running"`
 * rather than a fabricated result.
 */
export async function runAlertsNow(): Promise<RunAlertsResult> {
  const db = getDb();
  const now = new Date();

  const token = acquirePassLock(db, now);
  if (!token) {
    return { checked: 0, fired: 0, errors: 0, skipped: "already-running" };
  }

  try {
    const config = telegramConfigFromEnv();
    // Only the pass's own fetch calls get the timeout: createQuoteService
    // and createTelegramNotifier are also used outside this function (the
    // dashboard values holdings through the same quote service, unwrapped),
    // so the wrapping happens here rather than inside those factories.
    const fetchImpl = fetchWithTimeout(globalThis.fetch, REQUEST_TIMEOUT_MS);
    return await runAlerts({
      db,
      quotes: createQuoteService(db, fetchImpl),
      notifier: config ? createTelegramNotifier(config, fetchImpl) : null,
    });
  } finally {
    // Pass the token so a pass that outlived its own lease releases only
    // the lease it claimed, not one a later pass has since claimed. See
    // releasePassLock's doc comment in lib/alerts/pass-lock.ts.
    releasePassLock(db, token);
  }
}
