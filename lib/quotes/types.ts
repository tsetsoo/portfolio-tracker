export type AssetClass = "equity" | "crypto";

export interface Quote {
  price: number;
  currency: string;
  stale: boolean;
  fetchedAt: string;
}

export interface FxRate {
  rate: number;
  stale: boolean;
}

export type QuoteFetchOpts = {
  force?: boolean;
  /** Prefer cache even when past TTL; never hit the network. */
  cacheOnly?: boolean;
  preferredCurrency?: string;
};

export type FxFetchOpts = {
  force?: boolean;
  cacheOnly?: boolean;
};

export interface QuoteService {
  getQuote(
    symbol: string,
    assetClass: AssetClass,
    opts?: QuoteFetchOpts,
  ): Promise<Quote>;
  /** Batched crypto quotes (one CoinGecko request for uncached symbols). */
  getCryptoQuotes(
    symbols: string[],
    opts?: QuoteFetchOpts,
  ): Promise<Map<string, Quote>>;
  getFxRate(
    from: string,
    to: string,
    opts?: FxFetchOpts,
  ): Promise<FxRate>;
}
