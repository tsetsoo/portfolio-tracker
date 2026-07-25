import type { Lot } from "@/lib/domain/types";

export interface AggregatedLots {
  quantity: number;
  avgCostPerUnit: number | null;
  totalCostNative: number;
  costCurrency: string | null;
}

export class MixedCostCurrencyError extends Error {
  constructor() {
    super(
      "Cannot aggregate lots with mixed cost currencies; convert per lot in valueHolding",
    );
    this.name = "MixedCostCurrencyError";
  }
}

export function aggregateLots(lots: Lot[]): AggregatedLots {
  if (lots.length === 0) {
    return {
      quantity: 0,
      avgCostPerUnit: null,
      totalCostNative: 0,
      costCurrency: null,
    };
  }

  const currencies = new Set(lots.map((lot) => lot.costCurrency));
  if (currencies.size > 1) {
    throw new MixedCostCurrencyError();
  }

  const costCurrency = lots[0]!.costCurrency;
  let quantity = 0;
  let totalCostNative = 0;

  for (const lot of lots) {
    quantity += lot.quantity;
    totalCostNative += lot.quantity * lot.costPerUnit + lot.fees;
  }

  const avgCostPerUnit = quantity > 0 ? totalCostNative / quantity : null;

  return {
    quantity,
    avgCostPerUnit,
    totalCostNative,
    costCurrency,
  };
}
