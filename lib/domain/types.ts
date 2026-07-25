export type HoldingType = "equity" | "crypto" | "manual";

export interface Holding {
  id: string;
  type: HoldingType;
  symbol: string | null;
  name: string;
  quoteCurrency: string | null;
  manualValue: number | null;
  notes: string | null;
  updatedAt: string;
}

export interface Lot {
  id: string;
  holdingId: string;
  quantity: number;
  costPerUnit: number;
  costCurrency: string;
  purchasedAt: string;
  fees: number;
  externalTradeId: string | null;
}

export interface Settings {
  id: 1;
  baseCurrency: string;
}

export interface Quote {
  price: number;
  currency: string;
}

export interface ValuedHolding {
  holding: Holding;
  quantity: number;
  avgCostPerUnit: number | null;
  currentValueBase: number;
  costBasisBase: number | null;
  unrealizedPlBase: number | null;
  unrealizedPlPct: number | null;
}

export interface ValueHoldingInput {
  holding: Holding;
  lots: Lot[];
  price: Quote | null;
  baseCurrency: string;
  fxRates: Record<string, number>;
}

export interface PortfolioValuation {
  baseCurrency: string;
  totalBase: number;
  totalCostBase: number;
  unrealizedPlBase: number;
  holdings: ValuedHolding[];
  pricesOutdated: boolean;
  asOf: string;
}
