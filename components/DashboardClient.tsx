"use client";

import { useEffect, useRef, useState, useTransition } from "react";

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
import type { HoldingType, ValuedHolding } from "@/lib/domain/types";

const SECTIONS: Array<{
  type: HoldingType;
  title: string;
  eyebrow: string;
}> = [
  { type: "equity", title: "Stocks & ETFs", eyebrow: "Equities" },
  { type: "crypto", title: "Crypto", eyebrow: "Wallets" },
  { type: "manual", title: "Manual", eyebrow: "Entered by you" },
];

function sortHoldings(holdings: ValuedHolding[]): ValuedHolding[] {
  return [...holdings].sort((a, b) => {
    const byValue = b.currentValueBase - a.currentValueBase;
    if (byValue !== 0) return byValue;
    return (a.holding.symbol ?? a.holding.name).localeCompare(
      b.holding.symbol ?? b.holding.name,
    );
  });
}

function HoldingsSection({
  title,
  eyebrow,
  holdings,
  currency,
}: {
  title: string;
  eyebrow: string;
  holdings: ValuedHolding[];
  currency: string;
}) {
  if (holdings.length === 0) return null;

  return (
    <section className="dashboard-panel holdings-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <span>
          {holdings.length} {holdings.length === 1 ? "position" : "positions"}
        </span>
      </div>
      <div className="mobile-holdings">
        <HoldingsList holdings={holdings} currency={currency} />
      </div>
      <div className="desktop-holdings">
        <HoldingsTable holdings={holdings} currency={currency} />
      </div>
    </section>
  );
}

export function DashboardClient() {
  const [data, setData] = useState<DashboardPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const bgRefreshStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    bgRefreshStarted.current = false;

    startTransition(() => {
      void loadDashboardData({ cacheOnly: true })
        .then((next) => {
          if (cancelled) return;
          setData(next);
          setError(null);

          if (next.valuation.pricesOutdated && !bgRefreshStarted.current) {
            bgRefreshStarted.current = true;
            setIsRefreshing(true);
            void forceRefreshPortfolio()
              .then(() => loadDashboardData())
              .then((fresh) => {
                if (!cancelled) {
                  setData(fresh);
                  setError(null);
                }
              })
              .catch((err: unknown) => {
                if (!cancelled) {
                  setError(
                    err instanceof Error ? err.message : "Refresh failed",
                  );
                }
              })
              .finally(() => {
                if (!cancelled) setIsRefreshing(false);
              });
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
    setIsRefreshing(true);
    startTransition(() => {
      void forceRefreshPortfolio()
        .then(() => loadDashboardData())
        .then((next) => {
          setData(next);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Refresh failed");
        })
        .finally(() => setIsRefreshing(false));
    });
  }

  const busy = isPending || isRefreshing || !data;

  return (
    <main className="dashboard" aria-busy={busy || undefined}>
      <div className="dashboard-toolbar">
        <p>Overview</p>
        <button
          className="refresh-button"
          type="button"
          onClick={refreshPrices}
          disabled={isPending || isRefreshing}
        >
          <span aria-hidden="true">↻</span>
          {isRefreshing && data
            ? "Refreshing…"
            : isPending && data
              ? "Loading…"
              : "Refresh prices"}
        </button>
      </div>

      {error && <p className="page-load-error">{error}</p>}

      {!data ? (
        <div className="page-loading" role="status">
          Loading portfolio…
        </div>
      ) : (
        <>
          {(data.valuation.pricesOutdated || isRefreshing) && (
            <OutdatedBanner />
          )}

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

          {SECTIONS.map((section) => (
            <HoldingsSection
              key={section.type}
              title={section.title}
              eyebrow={section.eyebrow}
              holdings={sortHoldings(
                data.valuation.holdings.filter(
                  (item) => item.holding.type === section.type,
                ),
              )}
              currency={data.valuation.baseCurrency}
            />
          ))}
        </>
      )}
    </main>
  );
}
