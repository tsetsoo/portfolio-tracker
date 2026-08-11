import {
  collectBinanceSpotFills,
  parseBinanceAutoInvestCsv,
  parseBinanceConvertCsv,
} from "@/lib/binance/parse";
import { parseCryptoComTradesCsv } from "@/lib/cryptocom/parse";
import { collectPurchaseDates } from "@/lib/import/collect-purchase-dates";
import type { CryptoEurNeed } from "@/lib/import/fx-daily";
import { normalizeFxCurrency } from "@/lib/quotes/fx-aliases";

const FIAT = new Set(Intl.supportedValuesOf("currency"));

function needsCryptoFx(costCurrency: string): boolean {
  const ccy = normalizeFxCurrency(costCurrency);
  if (!ccy || ccy === "EUR") return false;
  // Stables → USD (fiat path / Frankfurter). Other ISO fiats too.
  if (FIAT.has(ccy)) return false;
  return true;
}

function addNeed(
  out: Map<string, CryptoEurNeed>,
  costCurrency: string,
  purchasedAt: string,
): void {
  if (!needsCryptoFx(costCurrency)) return;
  const symbol = costCurrency.trim().toUpperCase();
  const date = purchasedAt.slice(0, 10);
  out.set(`${symbol}|${date}`, { symbol, date });
}

/**
 * Dates + crypto quote currencies that need CoinGecko→EUR before FIFO settle.
 */
export function collectCryptoEurNeeds(input: {
  binanceSpotCsv?: string;
  binanceConvertCsv?: string;
  binanceAutoCsv?: string;
  cdcCsvs?: string[];
}): CryptoEurNeed[] {
  const out = new Map<string, CryptoEurNeed>();

  if (input.binanceSpotCsv?.trim()) {
    for (const fill of collectBinanceSpotFills(input.binanceSpotCsv).fills) {
      if (fill.side !== "BUY") continue;
      addNeed(out, fill.row.costCurrency, fill.row.purchasedAt);
    }
  }

  if (input.binanceConvertCsv?.trim()) {
    for (const row of parseBinanceConvertCsv(input.binanceConvertCsv).rows) {
      addNeed(out, row.costCurrency, row.purchasedAt);
    }
  }

  if (input.binanceAutoCsv?.trim()) {
    for (const row of parseBinanceAutoInvestCsv(input.binanceAutoCsv).rows) {
      addNeed(out, row.costCurrency, row.purchasedAt);
    }
  }

  for (const csv of input.cdcCsvs ?? []) {
    if (!csv.trim()) continue;
    const parsed = parseCryptoComTradesCsv(csv);
    for (const row of parsed.rows) {
      addNeed(out, row.costCurrency, row.purchasedAt);
    }
  }

  return [...out.values()].sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date),
  );
}

export { collectPurchaseDates };
