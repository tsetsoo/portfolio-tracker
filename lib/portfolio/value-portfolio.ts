import "server-only";

import type Database from "better-sqlite3";

import { aggregateLots, MixedCostCurrencyError } from "@/lib/domain/lots";
import type {
  Holding,
  HoldingType,
  Lot,
  PortfolioValuation,
  ValuedHolding,
} from "@/lib/domain/types";
import { valueHolding } from "@/lib/domain/valuation";
import {
  HANDPICKED_OVERVIEW_CRYPTO,
  valueHandpickedCrypto,
} from "@/lib/portfolio/handpicked-crypto";
import { createQuoteService } from "@/lib/quotes/service";
import type { Quote, QuoteService } from "@/lib/quotes/types";
import { getSettings } from "@/lib/settings";
import {
  listWalletAssetQuantities,
  walletAssetCost,
} from "@/lib/wallets/portfolio-assets";

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
  import_batch_id: string | null;
}

export interface ValuePortfolioOptions {
  forceRefresh?: boolean;
  /** Serve cached quotes/FX only — never call market APIs. */
  cacheOnly?: boolean;
  /** Holding types to value from the holdings table. Default: all. */
  holdingTypes?: HoldingType[];
  /** Include aggregated wallet balances as crypto positions. */
  includeWalletCrypto?: boolean;
  /** Include curated exchange/external crypto on the overview. */
  includeHandpickedCrypto?: boolean;
  getQuote?: QuoteService["getQuote"];
  getCryptoQuotes?: QuoteService["getCryptoQuotes"];
  getFxRate?: QuoteService["getFxRate"];
  now?: () => Date;
}

function readHoldings(
  db: Database.Database,
  types?: HoldingType[],
): Holding[] {
  const rows = db
    .prepare("SELECT * FROM holdings ORDER BY name, id")
    .all() as HoldingRow[];

  return rows
    .filter((row) => types == null || types.includes(row.type))
    .map((row) => ({
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
    importBatchId: row.import_batch_id ?? null,
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

function walletSyntheticHolding(asset: string): Holding {
  return {
    id: `wallet:${asset}`,
    type: "crypto",
    symbol: asset,
    name: `${asset} (wallets)`,
    quoteCurrency: null,
    manualValue: null,
    notes: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function valueWalletPosition(input: {
  asset: string;
  quantity: number;
  price: Quote | null;
  baseCurrency: string;
  fxRates: Record<string, number>;
  cost: ReturnType<typeof walletAssetCost>;
}): ValuedHolding {
  const holding = walletSyntheticHolding(input.asset);
  const costBasisBase = input.cost.complete ? input.cost.costBasisEur : null;
  const avgCostPerUnit = input.cost.complete
    ? input.cost.avgCostPerUnitEur
    : input.cost.avgCostPerUnitEur;

  let currentValueBase = 0;
  if (input.price) {
    const native = input.quantity * input.price.price;
    if (input.price.currency === input.baseCurrency) {
      currentValueBase = native;
    } else {
      const rate = input.fxRates[`${input.price.currency}>${input.baseCurrency}`];
      if (rate == null) {
        return {
          holding,
          quantity: input.quantity,
          avgCostPerUnit,
          currentValueBase: 0,
          costBasisBase,
          unrealizedPlBase: null,
          unrealizedPlPct: null,
        };
      }
      currentValueBase = native * rate;
    }
  }

  if (input.price == null || costBasisBase == null) {
    return {
      holding,
      quantity: input.quantity,
      avgCostPerUnit,
      currentValueBase,
      costBasisBase,
      unrealizedPlBase: null,
      unrealizedPlPct: null,
    };
  }

  const unrealizedPlBase = currentValueBase - costBasisBase;
  const unrealizedPlPct =
    costBasisBase !== 0 ? (unrealizedPlBase / costBasisBase) * 100 : null;

  return {
    holding,
    quantity: input.quantity,
    avgCostPerUnit,
    currentValueBase,
    costBasisBase,
    unrealizedPlBase,
    unrealizedPlPct,
  };
}

export async function valuePortfolio(
  db: Database.Database,
  opts: ValuePortfolioOptions = {},
): Promise<PortfolioValuation> {
  const baseCurrency = getSettings(db).baseCurrency;
  const holdings = readHoldings(db, opts.holdingTypes);
  const allLots = readLots(db);
  const quoteService = createQuoteService(db, globalThis.fetch);
  const getQuote = opts.getQuote ?? quoteService.getQuote;
  const getCryptoQuotes: QuoteService["getCryptoQuotes"] =
    opts.getCryptoQuotes ??
    (async (symbols, quoteOpts) => {
      // Tests often inject getQuote only — fan out so crypto still works.
      if (opts.getQuote) {
        const map = new Map<string, Quote>();
        await Promise.all(
          symbols.map(async (symbol) => {
            try {
              map.set(
                symbol.toUpperCase(),
                await opts.getQuote!(symbol, "crypto", quoteOpts),
              );
            } catch {
              // leave unpriced
            }
          }),
        );
        return map;
      }
      return quoteService.getCryptoQuotes(symbols, quoteOpts);
    });
  const getFxRate = opts.getFxRate ?? quoteService.getFxRate;
  const fetchOpts = {
    force: opts.forceRefresh,
    cacheOnly: opts.cacheOnly,
  };
  let pricesOutdated = false;

  const walletAssets = opts.includeWalletCrypto
    ? listWalletAssetQuantities(db)
    : [];
  const handpicked = opts.includeHandpickedCrypto
    ? HANDPICKED_OVERVIEW_CRYPTO
    : [];

  const equityHoldings = holdings.filter(
    (h): h is Holding & { type: "equity"; symbol: string } =>
      h.type === "equity" && h.symbol != null,
  );
  const cryptoHoldingSymbols = holdings
    .filter((h) => h.type === "crypto" && h.symbol)
    .map((h) => h.symbol!);
  const walletSymbols = walletAssets.map((a) => a.asset);
  const handpickedSymbols = handpicked.map((p) => p.symbol);
  const allCryptoSymbols = [
    ...new Set([
      ...cryptoHoldingSymbols,
      ...walletSymbols,
      ...handpickedSymbols,
    ]),
  ];

  const cryptoQuotes = await getCryptoQuotes(allCryptoSymbols, fetchOpts);
  for (const symbol of allCryptoSymbols) {
    const quote = cryptoQuotes.get(symbol);
    if (!quote) {
      pricesOutdated = true;
    } else {
      pricesOutdated ||= quote.stale;
    }
  }

  const quotes = new Map<string, Quote>();
  await Promise.all(
    equityHoldings.map(async (holding) => {
      try {
        const quote = await getQuote(holding.symbol, "equity", {
          ...fetchOpts,
          preferredCurrency: holding.quoteCurrency ?? undefined,
        });
        quotes.set(holding.id, quote);
        pricesOutdated ||= quote.stale;
      } catch {
        pricesOutdated = true;
      }
    }),
  );

  for (const holding of holdings) {
    if (holding.type !== "crypto" || holding.symbol == null) continue;
    const quote = cryptoQuotes.get(holding.symbol.toUpperCase());
    if (quote) quotes.set(holding.id, quote);
  }

  const currencies = new Set<string>();
  for (const lot of allLots) {
    if (holdings.some((h) => h.id === lot.holdingId)) {
      currencies.add(lot.costCurrency);
    }
  }
  for (const holding of holdings) {
    if (holding.type === "manual") {
      currencies.add(holding.quoteCurrency ?? baseCurrency);
    } else {
      const quote = quotes.get(holding.id);
      if (quote) currencies.add(quote.currency);
    }
  }
  for (const asset of walletAssets) {
    const quote = cryptoQuotes.get(asset.asset);
    if (quote) currencies.add(quote.currency);
  }
  for (const position of handpicked) {
    const quote = cryptoQuotes.get(position.symbol.toUpperCase());
    if (quote) currencies.add(quote.currency);
  }
  currencies.delete(baseCurrency);

  const fxRates: Record<string, number> = {};
  await Promise.all(
    [...currencies].map(async (currency) => {
      try {
        const fx = await getFxRate(currency, baseCurrency, fetchOpts);
        fxRates[`${currency}>${baseCurrency}`] = fx.rate;
        pricesOutdated ||= fx.stale;
      } catch {
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
      pricesOutdated = true;
      return unpricedHolding(holding, lots);
    }
  });

  const walletValued: ValuedHolding[] = walletAssets.map((asset) => {
    const quote = cryptoQuotes.get(asset.asset) ?? null;
    if (!quote) pricesOutdated = true;
    else pricesOutdated ||= quote.stale;

    const cost = walletAssetCost(db, asset.asset, asset.quantity);
    return valueWalletPosition({
      asset: asset.asset,
      quantity: asset.quantity,
      price: quote,
      baseCurrency,
      fxRates,
      cost,
    });
  });

  const handpickedResult = valueHandpickedCrypto(
    handpicked,
    cryptoQuotes,
    baseCurrency,
    fxRates,
  );
  pricesOutdated ||= handpickedResult.pricesOutdated;

  const combined = [
    ...valuedHoldings,
    ...walletValued,
    ...handpickedResult.holdings,
  ];

  return {
    baseCurrency,
    totalBase: combined.reduce(
      (total, holding) => total + holding.currentValueBase,
      0,
    ),
    totalCostBase: combined.reduce(
      (total, holding) => total + (holding.costBasisBase ?? 0),
      0,
    ),
    unrealizedPlBase: combined.reduce(
      (total, holding) => total + (holding.unrealizedPlBase ?? 0),
      0,
    ),
    holdings: combined,
    pricesOutdated,
    asOf: (opts.now ?? (() => new Date()))().toISOString(),
  };
}
