import { coingeckoIdForSymbol } from "@/lib/quotes/crypto-coingecko";
import type { AssetClass, Quote, QuoteService } from "@/lib/quotes/types";

/** Fail loudly rather than freeze a mispriced anchor onto the alert forever. */
function assertRequestedCurrency(
  symbol: string,
  requestedCurrency: string,
  quote: Quote,
): { symbol: string; price: number; currency: string; stale: boolean } {
  const currency = quote.currency.trim().toUpperCase();
  if (currency !== requestedCurrency) {
    throw new Error(
      `${symbol} came back priced in ${currency}, not the requested currency ${requestedCurrency}`,
    );
  }
  return { symbol, price: quote.price, currency, stale: quote.stale };
}

/**
 * Prove a symbol can be priced before an alert is stored, and return the
 * price that becomes the alert's anchor. Crypto is limited to the
 * COINGECKO_IDS map, so an unmapped symbol is rejected here rather than
 * becoming an alert that can never fire.
 *
 * `force: true` above only proves the provider was *asked* right now; on a
 * provider failure the quote service still returns a cached row with
 * `stale: true`. That flag is passed through so the caller can refuse to
 * anchor an alert on a price that was not actually refreshed.
 *
 * `requestedCurrency` is whatever currency the alert is being created in
 * (the portfolio base currency for equities today, or a user-chosen fiat
 * currency for crypto). The quote that comes back is asserted to actually
 * be in that currency: CoinGecko's pickVsPrice deliberately degrades to USD
 * when it has no price in the requested currency, and Yahoo can return a
 * listing's native currency, so trusting the provider's `currency` field
 * without checking it would silently freeze the wrong currency onto the
 * alert. fetchYahooQuote already rejects a currency mismatch itself, so
 * this check is belt-and-braces for equities and load-bearing for crypto.
 */
export async function resolveAlertSymbol(
  rawSymbol: string,
  assetClass: AssetClass,
  requestedCurrency: string,
  quotes: QuoteService,
): Promise<{ symbol: string; price: number; currency: string; stale: boolean }> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (symbol === "") {
    throw new Error("Symbol is required");
  }
  const currency = requestedCurrency.trim().toUpperCase();

  if (assetClass === "crypto") {
    if (coingeckoIdForSymbol(symbol) == null) {
      throw new Error(
        `${symbol} is not a supported crypto symbol. Add it to COINGECKO_IDS ` +
          `in lib/quotes/crypto-coingecko.ts first.`,
      );
    }
    const fetched = await quotes.getCryptoQuotes([symbol], {
      force: true,
      preferredCurrency: currency,
    });
    const quote = fetched.get(symbol);
    if (!quote) {
      throw new Error(`Could not fetch a price for ${symbol}`);
    }
    return assertRequestedCurrency(symbol, currency, quote);
  }

  const quote = await quotes.getQuote(symbol, "equity", {
    force: true,
    preferredCurrency: currency,
  });
  return assertRequestedCurrency(symbol, currency, quote);
}
