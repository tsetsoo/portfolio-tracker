"use client";

import { useEffect, useState, useTransition } from "react";

import {
  forceRefreshPortfolio,
  loadDashboardData,
  type DashboardPageData,
} from "@/app/actions/portfolio";
import { HistoryChart } from "@/components/HistoryChart";
import { HoldingsList } from "@/components/HoldingsList";
import { HoldingsTable } from "@/components/HoldingsTable";
import { NetWorthHeader } from "@/components/NetWorthHeader";
import { OutdatedBanner } from "@/components/OutdatedBanner";

export function DashboardClient() {
  const [data, setData] = useState<DashboardPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    startTransition(() => {
      void loadDashboardData()
        .then((next) => {
          if (!cancelled) {
            setData(next);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load");
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function refreshPrices() {
    startTransition(() => {
      void forceRefreshPortfolio()
        .then(() => loadDashboardData())
        .then((next) => {
          setData(next);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Refresh failed");
        });
    });
  }

  return (
    <main className="dashboard" aria-busy={isPending || !data || undefined}>
      <div className="dashboard-toolbar">
        <p>Overview</p>
        <button
          className="refresh-button"
          type="button"
          onClick={refreshPrices}
          disabled={isPending}
        >
          <span aria-hidden="true">↻</span>
          {isPending && data ? "Refreshing…" : "Refresh prices"}
        </button>
      </div>

      {error && <p className="page-load-error">{error}</p>}

      {!data ? (
        <div className="page-loading" role="status">
          Loading portfolio…
        </div>
      ) : (
        <>
          {data.valuation.pricesOutdated && <OutdatedBanner />}

          <NetWorthHeader
            total={data.valuation.totalBase}
            profitLoss={data.valuation.unrealizedPlBase}
            profitLossPct={data.profitLossPct}
            currency={data.valuation.baseCurrency}
            asOf={data.valuation.asOf}
          />

          <section className="dashboard-panel history-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Daily close</p>
                <h2>Portfolio history</h2>
              </div>
              <span>{data.snapshots.length} snapshots</span>
            </div>
            <HistoryChart
              snapshots={data.snapshots}
              currency={data.valuation.baseCurrency}
            />
          </section>

          <section className="dashboard-panel holdings-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Allocation detail</p>
                <h2>Holdings</h2>
              </div>
              <span>{data.valuation.holdings.length} positions</span>
            </div>
            <div className="mobile-holdings">
              <HoldingsList
                holdings={data.valuation.holdings}
                currency={data.valuation.baseCurrency}
              />
            </div>
            <div className="desktop-holdings">
              <HoldingsTable
                holdings={data.valuation.holdings}
                currency={data.valuation.baseCurrency}
              />
            </div>
          </section>
        </>
      )}
    </main>
  );
}
