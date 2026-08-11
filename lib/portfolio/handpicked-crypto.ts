import type { Holding, ValuedHolding } from "@/lib/domain/types";
import type { Quote } from "@/lib/quotes/types";

/**
 * Exchange / external crypto shown on the overview Crypto table alongside
 * wallet balances. Quantities and EUR costs are curated from imports + live
 * balances (not the messy residual exchange-holding FIFO leftovers).
 */
export type HandpickedCryptoPosition = {
  symbol: string;
  quantity: number;
  /** Total EUR cost basis when known; null → cost/P&L show as — */
  costBasisEur: number | null;
  venueNote: string;
};

export const HANDPICKED_OVERVIEW_CRYPTO: HandpickedCryptoPosition[] = [
  {
    symbol: "STX",
    quantity: 250,
    // Crypto.com: 50 @ €2.3532 (2021-12-02) + 200 @ €1.2221 (2022-01-24)
    costBasisEur: 362.08,
    venueNote: "Currently in Crypto.com",
  },
  {
    symbol: "AVAX",
    quantity: 42.89766,
    // Binance spot balance = CDC withdraw/deposit 14.273 + Binance buys (net).
    // EUR cost: CDC €1,138.89 + Binance USDT lots (dated USD→EUR) + BNB lots
    // (BNBUSDT×USD→EUR on purchase dates).
    costBasisEur: 2862.44,
    venueNote: "Currently on Binance",
  },
  {
    symbol: "ADA",
    quantity: 29.9,
    // Cardano is not a tracked wallet chain (app only syncs ETH/BTC/BCH).
    // No remaining costed lots match this balance — CDC's 400 ADA were swapped
    // to ETH; Binance ADA was sold. Cost left unknown until you confirm basis.
    costBasisEur: null,
    venueNote: "Cardano wallet (not synced)",
  },
];

function syntheticHolding(
  position: HandpickedCryptoPosition,
): Holding {
  return {
    id: `handpicked:${position.symbol}`,
    type: "crypto",
    symbol: position.symbol,
    name: position.venueNote,
    quoteCurrency: "EUR",
    manualValue: null,
    notes: position.venueNote,
    updatedAt: new Date(0).toISOString(),
  };
}

export function valueHandpickedCrypto(
  positions: HandpickedCryptoPosition[],
  quotes: Map<string, Quote>,
  baseCurrency: string,
  fxRates: Record<string, number>,
): { holdings: ValuedHolding[]; pricesOutdated: boolean } {
  let pricesOutdated = false;
  const holdings: ValuedHolding[] = [];

  for (const position of positions) {
    if (!(position.quantity > 0)) continue;
    const quote = quotes.get(position.symbol.toUpperCase()) ?? null;
    if (!quote) pricesOutdated = true;
    else pricesOutdated ||= quote.stale;

    let currentValueBase = 0;
    if (quote) {
      const native = position.quantity * quote.price;
      if (quote.currency === baseCurrency) {
        currentValueBase = native;
      } else {
        const rate = fxRates[`${quote.currency}>${baseCurrency}`];
        if (rate == null) {
          pricesOutdated = true;
          currentValueBase = 0;
        } else {
          currentValueBase = native * rate;
        }
      }
    }

    const costBasisBase = position.costBasisEur;
    const avgCostPerUnit =
      costBasisBase != null && position.quantity > 0
        ? costBasisBase / position.quantity
        : null;

    let unrealizedPlBase: number | null = null;
    let unrealizedPlPct: number | null = null;
    if (quote && costBasisBase != null) {
      unrealizedPlBase = currentValueBase - costBasisBase;
      unrealizedPlPct =
        costBasisBase !== 0
          ? (unrealizedPlBase / costBasisBase) * 100
          : null;
    }

    holdings.push({
      holding: syntheticHolding(position),
      quantity: position.quantity,
      avgCostPerUnit,
      currentValueBase,
      costBasisBase,
      unrealizedPlBase,
      unrealizedPlPct,
    });
  }

  return { holdings, pricesOutdated };
}
