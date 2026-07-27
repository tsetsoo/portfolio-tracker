import "server-only";

import type Database from "better-sqlite3";

import { aggregateLots, MixedCostCurrencyError } from "@/lib/domain/lots";
import type {
  Holding,
  Lot,
  PortfolioValuation,
  ValuedHolding,
} from "@/lib/domain/types";
import { valueHolding } from "@/lib/domain/valuation";
import { createQuoteService } from "@/lib/quotes/service";
import type { Quote, QuoteService } from "@/lib/quotes/types";
import { getSettings } from "@/lib/settings";

interface HoldingRow {
  id: string;
  type: Holding["type"];
  symbol: string | null;
  name: string;
  quote_currency: string | null;
  manual_value: number | null;
  notes: string | null;
  updated_at: string;
}

interface LotRow {
  id: string;
  holding_id: string;
  quantity: number;
  cost_per_unit: number;
  cost_currency: string;
  purchased_at: string;
  fees: number;
  external_trade_id: string | null;
}

export interface ValuePortfolioOptions {
  forceRefresh?: boolean;
  getQuote?: QuoteService["getQuote"];
  getFxRate?: QuoteService["getFxRate"];
  now?: () => Date;
}

function readHoldings(db: Database.Database): Holding[] {
  const rows = db
    .prepare("SELECT * FROM holdings ORDER BY name, id")
    .all() as HoldingRow[];

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    symbol: row.symbol,
    name: row.name,
    quoteCurrency: row.quote_currency,
    manualValue: row.manual_value,
    notes: row.notes,
    updatedAt: row.updated_at,
  }));
}

function readLots(db: Database.Database): Lot[] {
  const rows = db
    .prepare("SELECT * FROM lots ORDER BY purchased_at, id")
    .all() as LotRow[];

  return rows.map((row) => ({
    id: row.id,
    holdingId: row.holding_id,
    quantity: row.quantity,
    costPerUnit: row.cost_per_unit,
    costCurrency: row.cost_currency,
    purchasedAt: row.purchased_at,
    fees: row.fees,
    externalTradeId: row.external_trade_id,
  }));
}

/**
 * Best-effort fallback for a holding that could not be fully valued (missing
 * quote or FX rate). Never throws: the caller relies on this to keep the
 * rest of the portfolio valuation intact.
 */
function unpricedHolding(holding: Holding, lots: Lot[]): ValuedHolding {
  let quantity = 0;
  try {
    quantity = aggregateLots(lots).quantity;
  } catch (error) {
    if (error instanceof MixedCostCurrencyError) {
      quantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    } else {
      throw error;
    }
  }

  return {
    holding,
    quantity,
    avgCostPerUnit: null,
    currentValueBase: 0,
    costBasisBase: null,
    unrealizedPlBase: null,
    unrealizedPlPct: null,
  };
}

export async function valuePortfolio(
  db: Database.Database,
  opts: ValuePortfolioOptions = {},
): Promise<PortfolioValuation> {
  const baseCurrency = getSettings(db).baseCurrency;
  const holdings = readHoldings(db);
  const allLots = readLots(db);
  const quoteService = createQuoteService(db, globalThis.fetch);
  const getQuote = opts.getQuote ?? quoteService.getQuote;
  const getFxRate = opts.getFxRate ?? quoteService.getFxRate;
  let pricesOutdated = false;

  const quotes = new Map<string, Quote>();
  await Promise.all(
    holdings.map(async (holding) => {
      if (holding.type === "manual" || holding.symbol === null) return;
      try {
        const quote = await getQuote(holding.symbol, holding.type, {
          force: opts.forceRefresh,
          preferredCurrency: holding.quoteCurrency ?? undefined,
        });
        quotes.set(holding.id, quote);
        pricesOutdated ||= quote.stale;
      } catch {
        // No quote available (network/API failure with no cached price).
        // Treat the holding as unpriced rather than failing the whole page.
        pricesOutdated = true;
      }
    }),
  );

  const currencies = new Set<string>();
  for (const lot of allLots) currencies.add(lot.costCurrency);
  for (const holding of holdings) {
    if (holding.type === "manual") {
      currencies.add(holding.quoteCurrency ?? baseCurrency);
    } else {
      const quote = quotes.get(holding.id);
      if (quote) currencies.add(quote.currency);
    }
  }
  currencies.delete(baseCurrency);

  const fxRates: Record<string, number> = {};
  await Promise.all(
    [...currencies].map(async (currency) => {
      try {
        const fx = await getFxRate(currency, baseCurrency, {
          force: opts.forceRefresh,
        });
        fxRates[`${currency}>${baseCurrency}`] = fx.rate;
        pricesOutdated ||= fx.stale;
      } catch {
        // No FX rate available; holdings needing this currency will fall
        // back to unpriced below instead of throwing.
        pricesOutdated = true;
      }
    }),
  );

  const valuedHoldings = holdings.map((holding) => {
    const lots = allLots.filter((lot) => lot.holdingId === holding.id);
    try {
      return valueHolding({
        holding,
        lots,
        price: quotes.get(holding.id) ?? null,
        baseCurrency,
        fxRates,
      });
    } catch {
      // Most likely a missing FX rate for this holding's currency. Fall
      // back to an unpriced holding instead of failing the whole page.
      pricesOutdated = true;
      return unpricedHolding(holding, lots);
    }
  });

  return {
    baseCurrency,
    totalBase: valuedHoldings.reduce(
      (total, holding) => total + holding.currentValueBase,
      0,
    ),
    totalCostBase: valuedHoldings.reduce(
      (total, holding) => total + (holding.costBasisBase ?? 0),
      0,
    ),
    unrealizedPlBase: valuedHoldings.reduce(
      (total, holding) => total + (holding.unrealizedPlBase ?? 0),
      0,
    ),
    holdings: valuedHoldings,
    pricesOutdated,
    asOf: (opts.now ?? (() => new Date()))().toISOString(),
  };
}
