import { aggregateLots, MixedCostCurrencyError } from "@/lib/domain/lots";
import type {
  Lot,
  ValueHoldingInput,
  ValuedHolding,
} from "@/lib/domain/types";

export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number {
  if (from === to) {
    return amount;
  }

  const key = `${from}>${to}`;
  const rate = rates[key];
  if (rate === undefined) {
    throw new Error(`Missing FX rate: ${key}`);
  }

  return amount * rate;
}

function lotCostNative(lot: Lot): number {
  return lot.quantity * lot.costPerUnit + lot.fees;
}

function costBasisBaseFromLots(
  lots: Lot[],
  baseCurrency: string,
  fxRates: Record<string, number>,
): number | null {
  if (lots.length === 0) {
    return null;
  }

  let total = 0;
  for (const lot of lots) {
    total += convertAmount(
      lotCostNative(lot),
      lot.costCurrency,
      baseCurrency,
      fxRates,
    );
  }
  return total;
}

function unrealizedPl(
  currentValueBase: number,
  costBasisBase: number | null,
): { unrealizedPlBase: number | null; unrealizedPlPct: number | null } {
  if (costBasisBase === null) {
    return { unrealizedPlBase: null, unrealizedPlPct: null };
  }

  const unrealizedPlBase = currentValueBase - costBasisBase;
  const unrealizedPlPct =
    costBasisBase !== 0 ? (unrealizedPlBase / costBasisBase) * 100 : null;

  return { unrealizedPlBase, unrealizedPlPct };
}

export function valueHolding(input: ValueHoldingInput): ValuedHolding {
  const { holding, lots, price, baseCurrency, fxRates } = input;

  let quantity = 0;
  let avgCostPerUnit: number | null = null;
  let costCurrency: string | null = null;

  try {
    const aggregated = aggregateLots(lots);
    quantity = aggregated.quantity;
    avgCostPerUnit = aggregated.avgCostPerUnit;
    costCurrency = aggregated.costCurrency;
  } catch (error) {
    if (error instanceof MixedCostCurrencyError) {
      quantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
      avgCostPerUnit = null;
    } else {
      throw error;
    }
  }

  // Display avg cost in the portfolio's base currency so it is comparable
  // with the other base-currency columns (cost basis, value, P&L).
  if (avgCostPerUnit !== null && costCurrency !== null) {
    avgCostPerUnit = convertAmount(
      avgCostPerUnit,
      costCurrency,
      baseCurrency,
      fxRates,
    );
  }

  const costBasisBase = costBasisBaseFromLots(lots, baseCurrency, fxRates);

  if (holding.type === "manual") {
    const valueCurrency = holding.quoteCurrency ?? baseCurrency;
    const manualValue = holding.manualValue ?? 0;
    const currentValueBase = convertAmount(
      manualValue,
      valueCurrency,
      baseCurrency,
      fxRates,
    );

    const pl =
      lots.length > 0
        ? unrealizedPl(currentValueBase, costBasisBase)
        : { unrealizedPlBase: null, unrealizedPlPct: null };

    return {
      holding,
      quantity,
      avgCostPerUnit,
      currentValueBase,
      costBasisBase: lots.length > 0 ? costBasisBase : null,
      ...pl,
    };
  }

  const currentValueBase =
    price === null
      ? 0
      : convertAmount(
          quantity * price.price,
          price.currency,
          baseCurrency,
          fxRates,
        );

  // Without a live price we cannot know the position's real value, so avoid
  // showing a misleading -100% loss against the full cost basis.
  const pl =
    price === null
      ? { unrealizedPlBase: null, unrealizedPlPct: null }
      : unrealizedPl(currentValueBase, costBasisBase);

  return {
    holding,
    quantity,
    avgCostPerUnit,
    currentValueBase,
    costBasisBase,
    ...pl,
  };
}
