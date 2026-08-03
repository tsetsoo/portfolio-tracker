import type Database from "better-sqlite3";

import type { Lot, PortfolioValuation } from "@/lib/domain/types";
import { listHoldingsWithLots } from "@/lib/holdings-repo";
import {
  ensureTodaySnapshot,
  listSnapshots,
} from "@/lib/portfolio/snapshots";
import {
  valuePortfolio,
  type ValuePortfolioOptions,
} from "@/lib/portfolio/value-portfolio";

export type DashboardPageData = {
  valuation: PortfolioValuation;
  snapshots: { date: string; totalBase: number }[];
  profitLossPct: number | null;
};

export type HoldingsPageData = {
  valuation: PortfolioValuation;
  lotsByHolding: Record<string, Lot[]>;
};

export type DashboardPageDataOptions = ValuePortfolioOptions & {
  today?: string;
};

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function loadDashboardPageData(
  db: Database.Database,
  opts: DashboardPageDataOptions = {},
): Promise<DashboardPageData> {
  const valuation = await valuePortfolio(db, opts);
  const today = opts.today ?? localDateString(opts.now?.() ?? new Date());
  if (!valuation.pricesOutdated) {
    ensureTodaySnapshot(db, valuation, today);
  }
  const snapshots = listSnapshots(db);
  const profitLossPct =
    valuation.totalCostBase === 0
      ? null
      : (valuation.unrealizedPlBase / valuation.totalCostBase) * 100;

  return { valuation, snapshots, profitLossPct };
}

export async function loadHoldingsPageData(
  db: Database.Database,
  opts: ValuePortfolioOptions = {},
): Promise<HoldingsPageData> {
  const valuation = await valuePortfolio(db, opts);
  const holdingsWithLots = listHoldingsWithLots(db);
  const lotsByHolding = Object.fromEntries(
    holdingsWithLots.map((holding) => [holding.id, holding.lots]),
  );
  return { valuation, lotsByHolding };
}
