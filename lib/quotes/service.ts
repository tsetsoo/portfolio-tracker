import "server-only";

import type Database from "better-sqlite3";

import { getDb } from "@/lib/db/client";
import { isFiatCurrency } from "@/lib/format-money";
import {
  coingeckoIdForSymbol,
  fetchCoinGeckoQuotes,
} from "@/lib/quotes/crypto-coingecko";
import { fetchYahooQuote } from "@/lib/quotes/equity-yahoo";
import { normalizeFxCurrency } from "@/lib/quotes/fx-aliases";
import { fetchFrankfurterRate } from "@/lib/quotes/fx-frankfurter";
import type {
  AssetClass,
  FxFetchOpts,
  FxRate,
  Quote,
  QuoteFetchOpts,
  QuoteService,
} from "@/lib/quotes/types";

const CACHE_TTL_MS = 10 * 60 * 1000;

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

function readBaseCurrency(db: Database.Database): string {
  return (
    db.prepare("SELECT base_currency FROM settings WHERE id = 1").get() as {
      base_currency: string;
    }
  ).base_currency;
}

/**
 * fetchCoinGeckoQuotes can request any real fiat currency from CoinGecko
 * (falling back to USD itself if that currency has no price — see
 * pickVsPrice). A caller's preferredCurrency is honoured only when it names
 * a real fiat currency; anything else (a lot's quote_currency, which is
 * sometimes a stablecoin or another crypto token, e.g. USDT/CRO/BNB, not a
 * currency CoinGecko prices against) is treated the same as no preference
 * at all — the historic "whatever is cached" behaviour.
 */
function cryptoCurrencyOrUndefined(raw: string | undefined): string | undefined {
  const upper = raw?.trim().toUpperCase();
  return upper && isFiatCurrency(upper) ? upper : undefined;
}

export function createQuoteService(
  db: Database.Database,
  fetchImpl: typeof fetch,
): QuoteService {
  // `currency` is part of price_cache's primary key (symbol, asset_class,
  // currency), so a symbol can have one cached row per currency at once —
  // that is the whole point: the dashboard (holding.quoteCurrency) and the
  // alert pass (alert.currency, frozen at create time) can each hold their
  // own row instead of overwriting each other's on every read.
  //
  // When `currency` is given, read that exact row. When it is omitted, the
  // caller has no way to name which currency it wants, so fall back to
  // "whatever is cached for this symbol" — the same observable behaviour
  // this had before currency joined the key, back when only one row could
  // ever exist. With more than one row now possible, "whatever is cached"
  // is picked as the most recently fetched row, which is the closest
  // reading of that old behaviour: it favours the freshest data instead of
  // an arbitrary one.
  const readQuote = (
    symbol: string,
    assetClass: AssetClass,
    currency?: string,
  ): PriceCacheRow | undefined =>
    currency
      ? (db
          .prepare(
            `SELECT price, currency, fetched_at
             FROM price_cache
             WHERE symbol = ? AND asset_class = ? AND currency = ?`,
          )
          .get(symbol, assetClass, currency) as PriceCacheRow | undefined)
      : (db
          .prepare(
            `SELECT price, currency, fetched_at
             FROM price_cache
             WHERE symbol = ? AND asset_class = ?
             ORDER BY fetched_at DESC
             LIMIT 1`,
          )
          .get(symbol, assetClass) as PriceCacheRow | undefined);

  const readFxRate = (from: string, to: string): FxCacheRow | undefined =>
    db
      .prepare(
        `SELECT rate, fetched_at
         FROM fx_rates
         WHERE from_currency = ? AND to_currency = ?`,
      )
      .get(from, to) as FxCacheRow | undefined;

  const writeQuote = (
    symbol: string,
    assetClass: AssetClass,
    quote: { price: number; currency: string },
    fetchedAt: string,
  ): void => {
    db.prepare(
      `INSERT INTO price_cache
         (symbol, asset_class, price, currency, fetched_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(symbol, asset_class, currency) DO UPDATE SET
         price = excluded.price,
         fetched_at = excluded.fetched_at`,
    ).run(symbol, assetClass, quote.price, quote.currency, fetchedAt);
  };

  const cachedQuoteOrThrow = (
    symbol: string,
    assetClass: AssetClass,
    preferredCurrency?: string,
  ): Quote => {
    const cached = readQuote(symbol, assetClass, preferredCurrency);
    if (!cached) {
      throw new Error(`No cached quote for ${symbol}`);
    }
    return {
      price: cached.price,
      currency: cached.currency,
      stale: !isFresh(cached.fetched_at),
      fetchedAt: cached.fetched_at,
    };
  };

  const getCryptoQuotes = async (
    rawSymbols: string[],
    opts?: QuoteFetchOpts,
  ): Promise<Map<string, Quote>> => {
    const symbols = [
      ...new Set(
        rawSymbols
          .map((s) => s.trim().toUpperCase())
          .filter((s) => s.length > 0),
      ),
    ];
    const result = new Map<string, Quote>();
    if (symbols.length === 0) return result;

    const requestedCurrency = cryptoCurrencyOrUndefined(opts?.preferredCurrency);

    const missing: string[] = [];
    for (const symbol of symbols) {
      const cached = readQuote(symbol, "crypto", requestedCurrency);
      if (cached && !opts?.force && (opts?.cacheOnly || isFresh(cached.fetched_at))) {
        result.set(symbol, {
          price: cached.price,
          currency: cached.currency,
          stale: !isFresh(cached.fetched_at),
          fetchedAt: cached.fetched_at,
        });
      } else if (opts?.cacheOnly) {
        if (cached) {
          result.set(symbol, {
            price: cached.price,
            currency: cached.currency,
            stale: true,
            fetchedAt: cached.fetched_at,
          });
        }
        // else leave missing — caller treats as unpriced
      } else {
        missing.push(symbol);
      }
    }

    if (missing.length === 0) return result;

    const supportedMissing = missing.filter(
      (symbol) => coingeckoIdForSymbol(symbol) != null,
    );
    if (supportedMissing.length === 0) return result;

    const baseCurrency = requestedCurrency ?? readBaseCurrency(db);
    let fetched: Map<string, { price: number; currency: string }>;
    try {
      fetched = await fetchCoinGeckoQuotes(
        supportedMissing,
        baseCurrency,
        fetchImpl,
      );
    } catch {
      for (const symbol of missing) {
        const cached = readQuote(symbol, "crypto", requestedCurrency);
        if (cached) {
          result.set(symbol, {
            price: cached.price,
            currency: cached.currency,
            stale: true,
            fetchedAt: cached.fetched_at,
          });
        }
      }
      return result;
    }

    const fetchedAt = new Date().toISOString();
    for (const symbol of supportedMissing) {
      const quote = fetched.get(symbol);
      if (!quote) continue;
      writeQuote(symbol, "crypto", quote, fetchedAt);
      result.set(symbol, { ...quote, stale: false, fetchedAt });
    }
    return result;
  };

  return {
    async getQuote(
      rawSymbol: string,
      assetClass: AssetClass,
      opts?: QuoteFetchOpts,
    ): Promise<Quote> {
      const symbol = rawSymbol.toUpperCase();
      const preferredCurrency = opts?.preferredCurrency?.trim().toUpperCase();

      if (opts?.cacheOnly) {
        return cachedQuoteOrThrow(symbol, assetClass, preferredCurrency);
      }

      if (assetClass === "crypto") {
        const map = await getCryptoQuotes([symbol], opts);
        const quote = map.get(symbol);
        if (!quote) throw new Error(`No quote for ${symbol}`);
        return quote;
      }

      const cached = readQuote(symbol, assetClass, preferredCurrency);

      if (cached && !opts?.force && isFresh(cached.fetched_at)) {
        return {
          price: cached.price,
          currency: cached.currency,
          stale: false,
          fetchedAt: cached.fetched_at,
        };
      }

      let quote: { price: number; currency: string };
      try {
        quote = await fetchYahooQuote(symbol, fetchImpl, { preferredCurrency });
      } catch (error) {
        if (cached) {
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
      writeQuote(symbol, assetClass, quote, fetchedAt);
      return { ...quote, stale: false, fetchedAt };
    },

    getCryptoQuotes,

    async getFxRate(
      rawFrom: string,
      rawTo: string,
      opts?: FxFetchOpts,
    ): Promise<FxRate> {
      const from = normalizeFxCurrency(rawFrom);
      const to = normalizeFxCurrency(rawTo);
      if (from === to) {
        return { rate: 1, stale: false };
      }
      const cached = readFxRate(from, to);

      if (opts?.cacheOnly) {
        if (!cached) throw new Error(`No cached FX rate for ${from}>${to}`);
        return { rate: cached.rate, stale: !isFresh(cached.fetched_at) };
      }

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
  opts?: QuoteFetchOpts,
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
  opts?: FxFetchOpts,
): Promise<FxRate> {
  return createQuoteService(getDb(), globalThis.fetch).getFxRate(from, to, opts);
}
