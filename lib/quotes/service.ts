import "server-only";

import type Database from "better-sqlite3";

import { getDb } from "@/lib/db/client";
import { fetchCoinGeckoQuote } from "@/lib/quotes/crypto-coingecko";
import { fetchYahooQuote } from "@/lib/quotes/equity-yahoo";
import { fetchFrankfurterRate } from "@/lib/quotes/fx-frankfurter";
import type {
  AssetClass,
  FxRate,
  Quote,
  QuoteService,
} from "@/lib/quotes/types";

const CACHE_TTL_MS = 10 * 60 * 1000;

/** Stablecoins → USD for ECB FX (Frankfurter has no USDT/USDC). */
const FX_ALIASES: Record<string, string> = {
  USDT: "USD",
  USDC: "USD",
  BUSD: "USD",
  TUSD: "USD",
  FDUSD: "USD",
};

function normalizeFxCurrency(code: string): string {
  const upper = code.toUpperCase();
  return FX_ALIASES[upper] ?? upper;
}

interface PriceCacheRow {
  price: number;
  currency: string;
  fetched_at: string;
}

interface FxCacheRow {
  rate: number;
  fetched_at: string;
}

function isFresh(fetchedAt: string): boolean {
  return Date.now() - new Date(fetchedAt).getTime() < CACHE_TTL_MS;
}

export function createQuoteService(
  db: Database.Database,
  fetchImpl: typeof fetch,
): QuoteService {
  const readQuote = (
    symbol: string,
    assetClass: AssetClass,
  ): PriceCacheRow | undefined =>
    db
      .prepare(
        `SELECT price, currency, fetched_at
         FROM price_cache
         WHERE symbol = ? AND asset_class = ?`,
      )
      .get(symbol, assetClass) as PriceCacheRow | undefined;

  const readFxRate = (from: string, to: string): FxCacheRow | undefined =>
    db
      .prepare(
        `SELECT rate, fetched_at
         FROM fx_rates
         WHERE from_currency = ? AND to_currency = ?`,
      )
      .get(from, to) as FxCacheRow | undefined;

  return {
    async getQuote(
      rawSymbol: string,
      assetClass: AssetClass,
      opts?: { force?: boolean; preferredCurrency?: string },
    ): Promise<Quote> {
      const symbol = rawSymbol.toUpperCase();
      const preferredCurrency = opts?.preferredCurrency?.trim().toUpperCase();
      const cached = readQuote(symbol, assetClass);

      if (
        cached &&
        !opts?.force &&
        isFresh(cached.fetched_at) &&
        (!preferredCurrency ||
          cached.currency.toUpperCase() === preferredCurrency)
      ) {
        return {
          price: cached.price,
          currency: cached.currency,
          stale: false,
          fetchedAt: cached.fetched_at,
        };
      }

      let quote: { price: number; currency: string };
      try {
        quote =
          assetClass === "equity"
            ? await fetchYahooQuote(symbol, fetchImpl, { preferredCurrency })
            : await fetchCoinGeckoQuote(
                symbol,
                (
                  db
                    .prepare("SELECT base_currency FROM settings WHERE id = 1")
                    .get() as { base_currency: string }
                ).base_currency,
                fetchImpl,
              );
      } catch (error) {
        if (
          cached &&
          (!preferredCurrency ||
            cached.currency.toUpperCase() === preferredCurrency)
        ) {
          return {
            price: cached.price,
            currency: cached.currency,
            stale: true,
            fetchedAt: cached.fetched_at,
          };
        }
        throw error;
      }

      const fetchedAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO price_cache
           (symbol, asset_class, price, currency, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(symbol, asset_class) DO UPDATE SET
           price = excluded.price,
           currency = excluded.currency,
           fetched_at = excluded.fetched_at`,
      ).run(symbol, assetClass, quote.price, quote.currency, fetchedAt);

      return { ...quote, stale: false, fetchedAt };
    },

    async getFxRate(
      rawFrom: string,
      rawTo: string,
      opts?: { force?: boolean },
    ): Promise<FxRate> {
      const from = normalizeFxCurrency(rawFrom);
      const to = normalizeFxCurrency(rawTo);
      if (from === to) {
        return { rate: 1, stale: false };
      }
      const cached = readFxRate(from, to);

      if (cached && !opts?.force && isFresh(cached.fetched_at)) {
        return { rate: cached.rate, stale: false };
      }

      let rate: number;
      try {
        rate = await fetchFrankfurterRate(from, to, fetchImpl);
      } catch (error) {
        if (cached) return { rate: cached.rate, stale: true };
        throw error;
      }

      const fetchedAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO fx_rates
           (from_currency, to_currency, rate, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(from_currency, to_currency) DO UPDATE SET
           rate = excluded.rate,
           fetched_at = excluded.fetched_at`,
      ).run(from, to, rate, fetchedAt);

      return { rate, stale: false };
    },
  };
}

export function getQuote(
  symbol: string,
  assetClass: AssetClass,
  opts?: { force?: boolean; preferredCurrency?: string },
): Promise<Quote> {
  return createQuoteService(getDb(), globalThis.fetch).getQuote(
    symbol,
    assetClass,
    opts,
  );
}

export function getFxRate(
  from: string,
  to: string,
  opts?: { force?: boolean },
): Promise<FxRate> {
  return createQuoteService(getDb(), globalThis.fetch).getFxRate(from, to, opts);
}
