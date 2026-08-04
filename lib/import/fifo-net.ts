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

export type FifoConsumed = {
  externalTradeId: string | null;
  symbol: string;
  quantity: number;
  costBasis: number;
  costCurrency: string;
  disposition: "sell" | "withdrawal";
};

export type FifoNetResult = {
  rows: LotRow[];
  errors: Array<{ line: number; message: string }>;
  consumed: FifoConsumed[];
};

const QTY_EPS = 1e-10;

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
 * Apply sells FIFO against buys (chronological). Fully sold symbols are dropped;
 * partial sells reduce remaining lot quantity and prorate fees.
 * Also records cost basis consumed by each sell/withdrawal fill.
 */
export function netFillsFifo(fills: LotFill[]): FifoNetResult {
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
    let costBasis = 0;
    let costCurrency: string | null = null;
    let mixedCurrency = false;
    const requested = fill.row.quantity;

    while (remaining > QTY_EPS && queue.length > 0) {
      const lot = queue[0]!;
      if (costCurrency == null) costCurrency = lot.costCurrency;
      else if (lot.costCurrency !== costCurrency) mixedCurrency = true;
      const take = Math.min(lot.quantity, remaining);
      if (!mixedCurrency && costCurrency) {
        const feeShare = lot.quantity > 0 ? (take / lot.quantity) * lot.fees : 0;
        costBasis += take * lot.costPerUnit + feeShare;
      }
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
    if (applied > QTY_EPS && costCurrency && !mixedCurrency) {
      consumed.push({
        externalTradeId: fill.row.externalTradeId,
        symbol,
        quantity: applied,
        costBasis,
        costCurrency,
        disposition: fill.disposition ?? "sell",
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
