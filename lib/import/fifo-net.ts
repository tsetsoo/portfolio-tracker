import { normalizeFxCurrency } from "@/lib/quotes/fx-aliases";

export type LotRow = {
  symbol: string;
  quantity: number;
  costPerUnit: number;
  costCurrency: string;
  purchasedAt: string;
  fees: number;
  externalTradeId: string | null;
};

export type LotFill = {
  line: number;
  order: number;
  sortKey: string;
  side: "BUY" | "SELL";
  /** How a SELL should be described in preview notes (default: sell). */
  disposition?: "sell" | "withdrawal";
  row: LotRow;
};

/** One FIFO lot take that funded a sell/withdrawal (pre-FX amounts). */
export type FifoLotSlice = {
  lotExternalTradeId: string | null;
  purchasedAt: string;
  quantity: number;
  costCurrency: string;
  /** Cost in `costCurrency` for this slice (qty × cpu + fee share). */
  costAmount: number;
  costPerUnit: number;
};

export type FifoConsumed = {
  externalTradeId: string | null;
  symbol: string;
  quantity: number;
  costBasis: number;
  costCurrency: string;
  disposition: "sell" | "withdrawal";
  /** True when some lot costs could not be converted into a single currency. */
  partial?: boolean;
  /** Quote currencies whose costs could not be converted. */
  missingCurrencies?: string[];
  /** Lot mix that funded this disposition (for audits / repair dossiers). */
  lotSlices: FifoLotSlice[];
};

export type FifoNetResult = {
  rows: LotRow[];
  errors: Array<{ line: number; message: string }>;
  consumed: FifoConsumed[];
};

/** Convert lot cost currency into a target (usually portfolio base). */
export type FifoFxLookup = {
  baseCurrency: string;
  /** Multiply amount in `from` by this to get base. Same currency → 1. */
  rateToBase: (fromCurrency: string, asOfDate?: string) => number | null;
};

const QTY_EPS = 1e-10;

/** Official BGN/EUR peg (1 EUR = 1.95583 BGN) for CDC lots without FX cache. */
const BGN_PER_EUR = 1.95583;

const FIAT_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

export function cleanQty(quantity: number): number {
  const rounded = Math.round(quantity * 1e12) / 1e12;
  return Math.abs(rounded) < QTY_EPS ? 0 : rounded;
}

export function sortKeyFromDate(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(" ", "T");
}

/**
 * Sync FX helper for FIFO: DB rates first, then BGN↔EUR peg.
 */
export function createFifoFxLookup(options: {
  baseCurrency: string;
  /** rate such that amount_to = amount_from * rate for pair (from→to). */
  getRate?: (from: string, to: string) => number | null;
  /** Dated rate such that amount_to = amount_from * rate. */
  getDailyRate?: (from: string, to: string, date: string) => number | null;
}): FifoFxLookup {
  const base = normalizeFxCurrency(options.baseCurrency);
  return {
    baseCurrency: base,
    rateToBase: (fromCurrency: string, asOfDate?: string) => {
      const from = normalizeFxCurrency(fromCurrency);
      if (from === base) return 1;

      // Prefer cached daily (fiat or crypto→EUR) / spot rates before peg.
      const getRate =
        asOfDate && options.getDailyRate
          ? (rateFrom: string, rateTo: string) =>
              options.getDailyRate!(rateFrom, rateTo, asOfDate)
          : options.getRate;
      if (getRate) {
        const direct = getRate(from, base);
        if (direct != null && Number.isFinite(direct) && direct > 0) {
          return direct;
        }
        const inverse = getRate(base, from);
        if (inverse != null && Number.isFinite(inverse) && inverse > 0) {
          return 1 / inverse;
        }
      }
      if (from === "BGN" && base === "EUR") return 1 / BGN_PER_EUR;
      if (from === "EUR" && base === "BGN") return BGN_PER_EUR;
      // Without a cached rate, only known fiat pairs can resolve (nothing else).
      if (!FIAT_CURRENCIES.has(from) || !FIAT_CURRENCIES.has(base)) return null;
      return null;
    },
  };
}

type CostPiece = { currency: string; amount: number; purchasedAt: string };

function settleCostPieces(
  pieces: CostPiece[],
  fx?: FifoFxLookup | null,
): {
  costBasis: number;
  costCurrency: string;
  partial: boolean;
  missingCurrencies: string[];
} | null {
  if (pieces.length === 0) return null;

  if (!fx) {
    const currencies = new Set(pieces.map((piece) => piece.currency));
    if (currencies.size === 1) {
      return {
        costBasis: pieces.reduce((sum, piece) => sum + piece.amount, 0),
        costCurrency: pieces[0]!.currency,
        partial: false,
        missingCurrencies: [],
      };
    }

    // Legacy: no FX — prefer first currency piece only, mark partial.
    const first = pieces[0]!;
    let basis = 0;
    for (const piece of pieces) {
      if (piece.currency === first.currency) basis += piece.amount;
    }
    return {
      costBasis: basis,
      costCurrency: first.currency,
      partial: true,
      missingCurrencies: [...currencies]
        .filter((currency) => currency !== first.currency)
        .sort(),
    };
  }

  let basis = 0;
  const missingCurrencies = new Set<string>();
  for (const piece of pieces) {
    const rate = fx.rateToBase(
      piece.currency,
      piece.purchasedAt.slice(0, 10),
    );
    if (rate == null) {
      missingCurrencies.add(piece.currency.trim().toUpperCase());
      continue;
    }
    basis += piece.amount * rate;
  }
  const partial = missingCurrencies.size > 0;
  return {
    costBasis: basis,
    costCurrency: fx.baseCurrency,
    partial,
    missingCurrencies: [...missingCurrencies].sort(),
  };
}

/**
 * Apply sells FIFO against buys (chronological). Fully sold symbols are dropped;
 * partial sells reduce remaining lot quantity and prorate fees.
 * Also records cost basis consumed by each sell/withdrawal fill.
 *
 * When lot cost currencies mix, contributions are converted into `fx.baseCurrency`
 * when rates are available; missing rates yield `partial: true` with best-effort basis.
 */
export function netFillsFifo(
  fills: LotFill[],
  fx?: FifoFxLookup | null,
): FifoNetResult {
  const errors: FifoNetResult["errors"] = [];
  const consumed: FifoConsumed[] = [];
  const queues = new Map<string, LotRow[]>();
  const touched = new Set<string>();

  const chronological = [...fills].sort((a, b) => {
    const byTime = a.sortKey.localeCompare(b.sortKey);
    if (byTime !== 0) return byTime;
    return a.order - b.order;
  });

  for (const fill of chronological) {
    const symbol = fill.row.symbol;
    touched.add(symbol);
    const queue = queues.get(symbol) ?? [];
    queues.set(symbol, queue);

    if (fill.side === "BUY") {
      queue.push({ ...fill.row });
      continue;
    }

    let remaining = fill.row.quantity;
    const requested = fill.row.quantity;
    const pieces: CostPiece[] = [];
    const lotSlices: FifoLotSlice[] = [];

    while (remaining > QTY_EPS && queue.length > 0) {
      const lot = queue[0]!;
      const take = Math.min(lot.quantity, remaining);
      const feeShare = lot.quantity > 0 ? (take / lot.quantity) * lot.fees : 0;
      const costAmount = take * lot.costPerUnit + feeShare;
      pieces.push({
        currency: lot.costCurrency,
        amount: costAmount,
        purchasedAt: lot.purchasedAt,
      });
      lotSlices.push({
        lotExternalTradeId: lot.externalTradeId,
        purchasedAt: lot.purchasedAt,
        quantity: take,
        costCurrency: lot.costCurrency,
        costAmount,
        costPerUnit: lot.costPerUnit,
      });

      if (take + QTY_EPS >= lot.quantity) {
        remaining = cleanQty(remaining - lot.quantity);
        queue.shift();
      } else {
        const leftRatio = (lot.quantity - take) / lot.quantity;
        lot.quantity = cleanQty(lot.quantity - take);
        lot.fees *= leftRatio;
        remaining = cleanQty(remaining - take);
      }
    }

    const applied = cleanQty(requested - remaining);
    const settled = settleCostPieces(pieces, fx);
    if (applied > QTY_EPS && settled) {
      consumed.push({
        externalTradeId: fill.row.externalTradeId,
        symbol,
        quantity: applied,
        costBasis: settled.costBasis,
        costCurrency: settled.costCurrency,
        disposition: fill.disposition ?? "sell",
        partial: settled.partial || undefined,
        missingCurrencies:
          settled.missingCurrencies.length > 0
            ? settled.missingCurrencies
            : undefined,
        lotSlices,
      });
    }

    if (remaining > QTY_EPS) {
      errors.push({
        line: fill.line,
        message: `Sell exceeded open quantity for ${symbol} (leftover ${remaining})`,
      });
    } else {
      const label =
        fill.disposition === "withdrawal" ? "withdrawal" : "sell";
      errors.push({
        line: fill.line,
        message: `Applied ${label}: ${fill.row.quantity} ${symbol}`,
      });
    }
  }

  const rows: LotRow[] = [];
  for (const symbol of [...touched].sort()) {
    const queue = queues.get(symbol) ?? [];
    const open = queue.filter((lot) => lot.quantity > QTY_EPS);
    if (open.length === 0) {
      errors.push({ line: 0, message: `Closed position: ${symbol}` });
      continue;
    }
    rows.push(...open);
  }

  return { rows, errors, consumed };
}
