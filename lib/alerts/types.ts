import type { AssetClass } from "@/lib/quotes/types";

export type AlertKind = "threshold" | "percent_move";
export type ThresholdDirection = "above" | "below";
export type PercentDirection = "up" | "down" | "either";
export type AlertDirection = ThresholdDirection | PercentDirection;

export interface PriceAlert {
  id: string;
  symbol: string;
  assetClass: AssetClass;
  kind: AlertKind;
  direction: AlertDirection;
  /** Set for threshold alerts, null for percent alerts. */
  targetPrice: number | null;
  /** Fraction, not whole percent: 0.05 means 5%. */
  percent: number | null;
  anchorPrice: number | null;
  anchorAt: string | null;
  currency: string;
  label: string | null;
  enabled: boolean;
  cooldownMinutes: number;
  lastFiredAt: string | null;
  lastCheckedAt: string | null;
  lastPrice: number | null;
  lastError: string | null;
  createdAt: string;
}

export interface NewAlert {
  symbol: string;
  assetClass: AssetClass;
  kind: AlertKind;
  direction: AlertDirection;
  targetPrice?: number | null;
  percent?: number | null;
  /** Price at create time: the percent baseline, and the reference a message quotes. */
  anchorPrice: number;
  currency: string;
  label?: string | null;
  cooldownMinutes?: number;
}
