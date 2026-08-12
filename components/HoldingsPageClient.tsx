"use client";

import { useEffect, useState, useTransition } from "react";

import {
  loadHoldingsData,
  type HoldingsPageData,
} from "@/app/actions/portfolio";
import { HoldingForm } from "@/components/HoldingForm";
import { HoldingsManager } from "@/components/HoldingsManager";

export function HoldingsPageClient() {
  const [data, setData] = useState<HoldingsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reload() {
    startTransition(() => {
      void loadHoldingsData()
        .then((next) => {
          setData(next);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Failed to load");
        });
    });
  }

  useEffect(() => {
    let cancelled = false;
    startTransition(() => {
      void loadHoldingsData()
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

  return (
    <main
      className="dashboard management-page"
      aria-busy={isPending || !data || undefined}
    >
      <header className="page-header">
        <p className="eyebrow">Portfolio record</p>
        <h1>Holdings</h1>
        <p>
          Same positions as Home — wallet and curated crypto, plus equities and
          manual holdings.
        </p>
      </header>

      {error && <p className="page-load-error">{error}</p>}

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Valued now</p>
            <h2>Current positions</h2>
          </div>
          <span>
            {data
              ? `${data.valuation.holdings.length} ${
                  data.valuation.holdings.length === 1
                    ? "position"
                    : "positions"
                }`
              : "…"}
          </span>
        </div>
        {!data ? (
          <div className="page-loading" role="status">
            Loading holdings…
          </div>
        ) : (
          <HoldingsManager
            holdings={data.valuation.holdings}
            lotsByHolding={data.lotsByHolding}
            currency={data.valuation.baseCurrency}
            onMutated={reload}
          />
        )}
      </section>

      <section className="management-section">
        <div className="section-intro">
          <p className="eyebrow">New position</p>
          <h2>Add a holding</h2>
        </div>
        <HoldingForm onMutated={reload} />
      </section>
    </main>
  );
}
