"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  forceRefreshPortfolio,
  loadDashboardData,
} from "@/app/actions/portfolio";
import type { DashboardPageData } from "@/lib/portfolio/page-data";
import {
  AllocationDonut,
  type AllocationSlice,
} from "@/components/AllocationDonut";
import { HistoryCard } from "@/components/HistoryCard";
import { HoldingsList } from "@/components/HoldingsList";
import { HoldingsTable } from "@/components/HoldingsTable";
import { NetWorthHeader } from "@/components/NetWorthHeader";
import { OutdatedBanner } from "@/components/OutdatedBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { RefreshIcon } from "@/components/ui/icons";
import type { HoldingType, ValuedHolding } from "@/lib/domain/types";

const SECTIONS: Array<{
  type: HoldingType;
  title: string;
  eyebrow: string;
}> = [
  { type: "equity", title: "Stocks & ETFs", eyebrow: "Equities" },
  { type: "crypto", title: "Crypto", eyebrow: "Wallets & exchanges" },
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
  totalBase,
}: {
  title: string;
  eyebrow: string;
  holdings: ValuedHolding[];
  currency: string;
  totalBase: number;
}) {
  if (holdings.length === 0) return null;

  return (
    <Card className="mt-4">
      <SectionHeading
        eyebrow={eyebrow}
        title={title}
        meta={`${holdings.length} ${holdings.length === 1 ? "position" : "positions"}`}
      />
      <div className="lg:hidden">
        <HoldingsList holdings={holdings} currency={currency} />
      </div>
      <div className="hidden lg:block">
        <HoldingsTable
          holdings={holdings}
          currency={currency}
          totalBase={totalBase}
        />
      </div>
    </Card>
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
  const total = data?.valuation.totalBase ?? 0;

  const slices: AllocationSlice[] = data
    ? SECTIONS.map((section) => {
        const value = data.valuation.holdings
          .filter((item) => item.holding.type === section.type)
          .reduce((sum, item) => sum + item.currentValueBase, 0);
        return {
          type: section.type,
          label: section.title,
          value,
          share: total > 0 ? value / total : 0,
        };
      }).filter((slice) => slice.value !== 0)
    : [];

  return (
    <Page aria-busy={busy || undefined}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="eyebrow">Overview</p>
        <Button
          variant="secondary"
          onClick={refreshPrices}
          disabled={isPending || isRefreshing}
        >
          <RefreshIcon />
          {isRefreshing && data
            ? "Refreshing…"
            : isPending && data
              ? "Loading…"
              : "Refresh prices"}
        </Button>
      </div>

      {error && (
        <p className="mb-4 rounded-card border border-loss/30 bg-loss/8 px-4 py-3 text-xs text-loss">
          {error}
        </p>
      )}

      {!data ? (
        <div className="py-8 text-sm text-dim" role="status">
          Loading portfolio…
        </div>
      ) : (
        <>
          {(data.valuation.pricesOutdated || isRefreshing) && (
            <div className="mb-4">
              <OutdatedBanner />
            </div>
          )}

          <NetWorthHeader
            total={data.valuation.totalBase}
            profitLoss={data.valuation.unrealizedPlBase}
            profitLossPct={data.profitLossPct}
            currency={data.valuation.baseCurrency}
            asOf={data.valuation.asOf}
          />

          <div className="mt-4 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            {slices.length > 1 && (
              <Card>
                <SectionHeading
                  eyebrow="Composition"
                  title="Allocation"
                  meta={`${slices.length} classes`}
                />
                <AllocationDonut
                  slices={slices}
                  total={data.valuation.totalBase}
                  currency={data.valuation.baseCurrency}
                />
              </Card>
            )}
            <HistoryCard
              snapshots={data.snapshots}
              currency={data.valuation.baseCurrency}
            />
          </div>

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
              totalBase={data.valuation.totalBase}
            />
          ))}
        </>
      )}
    </Page>
  );
}
