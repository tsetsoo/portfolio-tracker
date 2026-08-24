import type Database from "better-sqlite3";

import { isFiatCurrency } from "@/lib/format-money";
import { getSettings } from "@/lib/settings";

// isFiatCurrency only checks that a code is a *well-formed* three-letter
// currency code (the ECMA-402 rule Intl.NumberFormat itself enforces) — it
// does not check that the code names a currency that actually exists.
// Three-letter crypto tickers such as BNB and CRO are well-formed, so
// isFiatCurrency alone would wrongly let them through here. Intersecting
// with Intl.supportedValuesOf("currency"), which is the real ISO-4217 list,
// closes that gap without touching isFiatCurrency's own behaviour (and
// therefore without touching formatMoney's output).
const ISO_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

function isRealFiatCurrency(code: string): boolean {
  return isFiatCurrency(code) && ISO_CURRENCIES.has(code);
}

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
