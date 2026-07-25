import { forceRefreshPortfolio } from "@/app/actions/portfolio";
import { HistoryChart } from "@/components/HistoryChart";
import { HoldingsList } from "@/components/HoldingsList";
import { HoldingsTable } from "@/components/HoldingsTable";
import { NetWorthHeader } from "@/components/NetWorthHeader";
import { OutdatedBanner } from "@/components/OutdatedBanner";
import { getDb } from "@/lib/db/client";
import {
  ensureTodaySnapshot,
  listSnapshots,
} from "@/lib/portfolio/snapshots";
import { valuePortfolio } from "@/lib/portfolio/value-portfolio";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = getDb();
  const valuation = await valuePortfolio(db);
  ensureTodaySnapshot(db, valuation, valuation.asOf.slice(0, 10));
  const snapshots = listSnapshots(db);
  const profitLossPct =
    valuation.totalCostBase === 0
      ? null
      : (valuation.unrealizedPlBase / valuation.totalCostBase) * 100;

  return (
    <main className="dashboard">
      <div className="dashboard-toolbar">
        <p>Overview</p>
        <form action={forceRefreshPortfolio}>
          <button className="refresh-button" type="submit">
            <span aria-hidden="true">↻</span>
            Refresh prices
          </button>
        </form>
      </div>

      {valuation.pricesOutdated && <OutdatedBanner />}

      <NetWorthHeader
        total={valuation.totalBase}
        profitLoss={valuation.unrealizedPlBase}
        profitLossPct={profitLossPct}
        currency={valuation.baseCurrency}
        asOf={valuation.asOf}
      />

      <section className="dashboard-panel history-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Daily close</p>
            <h2>Portfolio history</h2>
          </div>
          <span>{snapshots.length} snapshots</span>
        </div>
        <HistoryChart
          snapshots={snapshots}
          currency={valuation.baseCurrency}
        />
      </section>

      <section className="dashboard-panel holdings-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Allocation detail</p>
            <h2>Holdings</h2>
          </div>
          <span>{valuation.holdings.length} positions</span>
        </div>
        <div className="mobile-holdings">
          <HoldingsList
            holdings={valuation.holdings}
            currency={valuation.baseCurrency}
          />
        </div>
        <div className="desktop-holdings">
          <HoldingsTable
            holdings={valuation.holdings}
            currency={valuation.baseCurrency}
          />
        </div>
      </section>
    </main>
  );
}
