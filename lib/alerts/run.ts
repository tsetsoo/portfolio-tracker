import "server-only";

import type Database from "better-sqlite3";

import { evaluateAlert } from "@/lib/alerts/evaluate";
import { listArmedAlerts, recordCheck, recordFire } from "@/lib/alerts/repo";
import {
  createTelegramNotifier,
  formatAlertMessage,
  telegramConfigFromEnv,
  type AlertNotifier,
} from "@/lib/alerts/telegram";
import type { PriceAlert } from "@/lib/alerts/types";
import { getDb } from "@/lib/db/client";
import { createQuoteService } from "@/lib/quotes/service";
import type { Quote, QuoteService } from "@/lib/quotes/types";

export interface RunAlertsResult {
  checked: number;
  fired: number;
  errors: number;
  skipped?: "telegram-not-configured";
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

    const decision = evaluateAlert(alert, quote, now);

    if (!decision.fires) {
      if (decision.detail) errors += 1;
      recordCheck(opts.db, alert.id, {
        checkedAt,
        price: quote.price,
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

/** Wired to the real database, quote service, and env-configured bot. */
export async function runAlertsNow(): Promise<RunAlertsResult> {
  const db = getDb();
  const config = telegramConfigFromEnv();
  return runAlerts({
    db,
    quotes: createQuoteService(db, globalThis.fetch),
    notifier: config
      ? createTelegramNotifier(config, globalThis.fetch)
      : null,
  });
}
