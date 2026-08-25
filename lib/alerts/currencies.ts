import type Database from "better-sqlite3";

import { isRealFiatCurrency } from "@/lib/format-money";
import { getSettings } from "@/lib/settings";

/**
 * Currencies a crypto alert may be denominated in: the portfolio base
 * currency, plus every real fiat currency the user has actually
 * transacted in (a lot's cost_currency). Non-fiat lot denominations —
 * stablecoins or other crypto tokens such as USDT/CRO/BNB — are excluded,
 * since CoinGecko cannot price against them as a vs currency.
 *
 * Base currency first (the sensible form default), deduplicated,
 * upper-cased, and stable order otherwise.
 */
export function allowedAlertCurrencies(db: Database.Database): string[] {
  const baseCurrency = getSettings(db).baseCurrency.trim().toUpperCase();

  const rows = db
    .prepare("SELECT DISTINCT cost_currency FROM lots")
    .all() as { cost_currency: string }[];

  const lotFiatCurrencies = rows
    .map((row) => row.cost_currency.trim().toUpperCase())
    .filter((code) => isRealFiatCurrency(code));

  return [...new Set([baseCurrency, ...lotFiatCurrencies])];
}
