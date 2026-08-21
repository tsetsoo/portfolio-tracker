import { coingeckoIdForSymbol } from "@/lib/quotes/crypto-coingecko";
import type { AssetClass, QuoteService } from "@/lib/quotes/types";

/**
 * Prove a symbol can be priced before an alert is stored, and return the
 * price that becomes the alert's anchor. Crypto is limited to the
 * COINGECKO_IDS map, so an unmapped symbol is rejected here rather than
 * becoming an alert that can never fire.
 */
export async function resolveAlertSymbol(
  rawSymbol: string,
  assetClass: AssetClass,
  baseCurrency: string,
  quotes: QuoteService,
): Promise<{ symbol: string; price: number; currency: string }> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (symbol === "") {
    throw new Error("Symbol is required");
  }

  if (assetClass === "crypto") {
    if (coingeckoIdForSymbol(symbol) == null) {
      throw new Error(
        `${symbol} is not a supported crypto symbol. Add it to COINGECKO_IDS ` +
          `in lib/quotes/crypto-coingecko.ts first.`,
      );
    }
    const fetched = await quotes.getCryptoQuotes([symbol], { force: true });
    const quote = fetched.get(symbol);
    if (!quote) {
      throw new Error(`Could not fetch a price for ${symbol}`);
    }
    return {
      symbol,
      price: quote.price,
      currency: quote.currency.trim().toUpperCase(),
    };
  }

  const quote = await quotes.getQuote(symbol, "equity", {
    force: true,
    preferredCurrency: baseCurrency,
  });
  return {
    symbol,
    price: quote.price,
    currency: quote.currency.trim().toUpperCase(),
  };
}
