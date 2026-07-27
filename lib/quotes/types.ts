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

export interface QuoteService {
  getQuote(
    symbol: string,
    assetClass: AssetClass,
    opts?: { force?: boolean; preferredCurrency?: string },
  ): Promise<Quote>;
  getFxRate(
    from: string,
    to: string,
    opts?: { force?: boolean },
  ): Promise<FxRate>;
}
