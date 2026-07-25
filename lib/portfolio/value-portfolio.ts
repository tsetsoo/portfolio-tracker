import type Database from "better-sqlite3";

import type {
  Holding,
  Lot,
  PortfolioValuation,
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
      const quote = await getQuote(holding.symbol, holding.type, {
        force: opts.forceRefresh,
      });
      quotes.set(holding.id, quote);
      pricesOutdated ||= quote.stale;
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
      const fx = await getFxRate(currency, baseCurrency, {
        force: opts.forceRefresh,
      });
      fxRates[`${currency}>${baseCurrency}`] = fx.rate;
      pricesOutdated ||= fx.stale;
    }),
  );

  const valuedHoldings = holdings.map((holding) =>
    valueHolding({
      holding,
      lots: allLots.filter((lot) => lot.holdingId === holding.id),
      price: quotes.get(holding.id) ?? null,
      baseCurrency,
      fxRates,
    }),
  );

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
