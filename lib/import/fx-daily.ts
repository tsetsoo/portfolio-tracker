import type Database from "better-sqlite3";
import { normalizeFxCurrency } from "@/lib/quotes/fx-aliases";
import { fetchFrankfurterRateOnDate } from "@/lib/quotes/fx-frankfurter";
import {
  fetchBinanceDailyClose,
} from "@/lib/quotes/binance-klines";
import {
  fetchCoinGeckoMarketChartRange,
  pickPriceOnOrBefore,
  coingeckoIdForSymbol,
} from "@/lib/quotes/crypto-coingecko";

export function getDailyFxRate(
  db: Database.Database,
  from: string,
  to: string,
  rateDate: string,
): number | null {
  const fromCurrency = normalizeFxCurrency(from);
  const toCurrency = normalizeFxCurrency(to);
  const row = db
    .prepare(
      `SELECT rate FROM fx_rates_daily
       WHERE rate_date = ? AND from_currency = ? AND to_currency = ?`,
    )
    .get(rateDate, fromCurrency, toCurrency) as { rate: number } | undefined;
  return row?.rate ?? null;
}

export function upsertDailyFxRate(
  db: Database.Database,
  from: string,
  to: string,
  rateDate: string,
  rate: number,
): void {
  const fromCurrency = normalizeFxCurrency(from);
  const toCurrency = normalizeFxCurrency(to);
  db.prepare(
    `INSERT INTO fx_rates_daily (rate_date, from_currency, to_currency, rate, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (rate_date, from_currency, to_currency)
     DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at`,
  ).run(rateDate, fromCurrency, toCurrency, rate, new Date().toISOString());
}

export async function prefetchUsdEurDailyRates(
  db: Database.Database,
  dates: string[],
  fetchImpl: typeof fetch,
): Promise<{ fetched: number; failed: string[] }> {
  const uniqueDates = [...new Set(dates)];
  let fetched = 0;
  const failed: string[] = [];

  for (const date of uniqueDates) {
    if (getDailyFxRate(db, "USD", "EUR", date) !== null) {
      continue;
    }
    try {
      const rate = await fetchFrankfurterRateOnDate("USD", "EUR", date, fetchImpl);
      upsertDailyFxRate(db, "USD", "EUR", date, rate);
      fetched++;
    } catch {
      failed.push(date);
    }
  }

  return { fetched, failed };
}

export type CryptoEurNeed = { symbol: string; date: string };

function yearAgoUtcDate(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Prefetch crypto→EUR into fx_rates_daily.
 * 1) Binance klines (*EUR or *USDT × USD→EUR) — full history, no key
 * 2) CoinGecko market_chart/range fallback for last 365 days only
 */
export async function prefetchCryptoEurDailyRates(
  db: Database.Database,
  needs: CryptoEurNeed[],
  fetchImpl: typeof fetch,
  options: { pauseMs?: number } = {},
): Promise<{ fetched: number; failed: string[]; skippedUnknown: string[] }> {
  const pauseMs = options.pauseMs ?? 400;
  const bySymbol = new Map<string, Set<string>>();
  for (const need of needs) {
    const symbol = need.symbol.trim().toUpperCase();
    const date = need.date.slice(0, 10);
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (symbol === "EUR") continue;
    const dates = bySymbol.get(symbol) ?? new Set<string>();
    dates.add(date);
    bySymbol.set(symbol, dates);
  }

  let fetched = 0;
  const failed: string[] = [];
  const skippedUnknown: string[] = [];
  const cgCutoff = yearAgoUtcDate();

  let first = true;
  for (const [symbol, dateSet] of [...bySymbol.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const dates = [...dateSet].sort();
    const missing = dates.filter(
      (date) => getDailyFxRate(db, symbol, "EUR", date) == null,
    );
    if (missing.length === 0) continue;

    if (!first && pauseMs > 0) {
      await new Promise((r) => setTimeout(r, pauseMs));
    }
    first = false;

    let series: Array<{ date: string; price: number }> | null = null;

    // Prefer Binance *EUR, then *USDT × USD→EUR.
    for (const quote of ["EUR", "USDT"] as const) {
      try {
        const raw = await fetchBinanceDailyClose(
          symbol,
          quote,
          missing[0]!,
          missing[missing.length - 1]!,
          fetchImpl,
        );
        if (raw.length === 0) continue;
        if (quote === "EUR") {
          series = raw;
          break;
        }
        series = [];
        for (const point of raw) {
          let usdEur = getDailyFxRate(db, "USD", "EUR", point.date);
          if (usdEur == null) {
            try {
              usdEur = await fetchFrankfurterRateOnDate(
                "USD",
                "EUR",
                point.date,
                fetchImpl,
              );
              upsertDailyFxRate(db, "USD", "EUR", point.date, usdEur);
            } catch {
              continue;
            }
          }
          series.push({ date: point.date, price: point.price * usdEur });
        }
        if (series.length > 0) break;
        series = null;
      } catch {
        series = null;
      }
    }

    // CoinGecko only for dates within the public 365-day window.
    const stillMissingAfterBinance = missing.filter(
      (date) => pickPriceOnOrBefore(series ?? [], date) == null,
    );
    const cgDates = stillMissingAfterBinance.filter((d) => d >= cgCutoff);
    if (cgDates.length > 0 && coingeckoIdForSymbol(symbol)) {
      try {
        if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
        const cg = await fetchCoinGeckoMarketChartRange(
          symbol,
          "EUR",
          cgDates[0]!,
          cgDates[cgDates.length - 1]!,
          fetchImpl,
        );
        const merged = new Map<string, number>();
        for (const p of series ?? []) merged.set(p.date, p.price);
        for (const p of cg) merged.set(p.date, p.price);
        series = [...merged.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, price]) => ({ date, price }));
      } catch {
        // leave series as-is
      }
    }

    if (!series || series.length === 0) {
      // No market data source for this symbol (e.g. CRO — not on Binance spot).
      skippedUnknown.push(symbol);
      continue;
    }

    for (const date of missing) {
      const price = pickPriceOnOrBefore(series, date);
      if (price == null || !(price > 0)) {
        failed.push(`${symbol}@${date}`);
        continue;
      }
      upsertDailyFxRate(db, symbol, "EUR", date, price);
      fetched++;
    }
  }

  return { fetched, failed, skippedUnknown: [...new Set(skippedUnknown)] };
}
