import type Database from "better-sqlite3";
import { normalizeFxCurrency } from "@/lib/quotes/fx-aliases";
import { fetchFrankfurterRateOnDate } from "@/lib/quotes/fx-frankfurter";

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
