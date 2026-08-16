"use client";

import { useEffect, useState, useTransition } from "react";

import { loadHoldingsData } from "@/app/actions/portfolio";
import type { HoldingsPageData } from "@/lib/portfolio/page-data";
import { HoldingForm } from "@/components/HoldingForm";
import { HoldingsManager } from "@/components/HoldingsManager";
import { Page, PageHeader } from "@/components/ui/PageHeader";

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
    <Page width="narrow" aria-busy={isPending || !data || undefined}>
      <PageHeader
        eyebrow="Portfolio record"
        title="Holdings"
        description="Same positions as Home — wallet and curated crypto, plus equities and manual holdings."
      />

      {error && (
        <p className="mt-6 rounded-card border border-loss/30 bg-loss/8 px-4 py-3 text-xs text-loss">
          {error}
        </p>
      )}

      <div className="mt-6">
        {!data ? (
          <div className="py-8 text-sm text-dim" role="status">
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
      </div>

      <section className="mt-10 border-t border-line pt-8">
        <p className="eyebrow">New position</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          Add a holding
        </h2>
        <HoldingForm onMutated={reload} />
      </section>
    </Page>
  );
}
