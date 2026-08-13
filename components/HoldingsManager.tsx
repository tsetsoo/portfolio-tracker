"use client";

import {
  deleteHoldingAction,
  updateManualValueAction,
} from "@/app/actions/portfolio";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { directionOf, toneClass } from "@/components/ui/Delta";
import { FIELD_CONTROL } from "@/components/ui/Field";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { HoldingType, Lot, ValuedHolding } from "@/lib/domain/types";
import { formatMoney, formatSignedMoney } from "@/lib/format-money";

interface HoldingsManagerProps {
  holdings: ValuedHolding[];
  lotsByHolding: Record<string, Lot[]>;
  currency: string;
  onMutated?: () => void;
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 8,
  }).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function sortLots(lots: Lot[]): Lot[] {
  return [...lots].sort((a, b) => {
    const byDate = a.purchasedAt.localeCompare(b.purchasedAt);
    if (byDate !== 0) return byDate;
    return a.id.localeCompare(b.id);
  });
}

function sortHoldings(holdings: ValuedHolding[]): ValuedHolding[] {
  return [...holdings].sort((a, b) => {
    const aSymbol = a.holding.symbol ?? a.holding.name;
    const bSymbol = b.holding.symbol ?? b.holding.name;
    return aSymbol.localeCompare(bSymbol);
  });
}

function HoldingCard({
  item,
  lots,
  currency,
  onMutated,
}: {
  item: ValuedHolding;
  lots: Lot[];
  currency: string;
  onMutated?: () => void;
}) {
  const pl = item.unrealizedPlBase;
  const direction = directionOf(pl);
  const isManual = item.holding.type === "manual";
  const isDerived =
    item.holding.id.startsWith("wallet:") ||
    item.holding.id.startsWith("handpicked:");

  return (
    <article className="border-b border-line last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_120px_150px]">
        <div className="min-w-0">
          <span className="font-mono text-[13px] font-semibold">
            {item.holding.symbol ?? "MAN"}
          </span>
          <p className="mt-0.5 truncate text-[11px] text-dim">
            {item.holding.name}
          </p>
        </div>

        <div className="hidden sm:grid">
          <span className="eyebrow">Units</span>
          <strong className="mt-0.5 font-mono text-xs font-semibold tabular-nums">
            {isManual ? "—" : formatQuantity(item.quantity)}
          </strong>
        </div>

        <div className="grid justify-items-end">
          <strong className="font-mono text-[13px] font-semibold tabular-nums">
            {formatMoney(item.currentValueBase, currency)}
          </strong>
          <span
            className={`mt-0.5 font-mono text-[10px] tabular-nums ${toneClass(direction)}`}
          >
            {pl == null ? "Manual value" : formatSignedMoney(pl, currency)}
          </span>
        </div>
      </div>

      {(isManual || !isDerived) && (
        <div className="flex flex-wrap items-end gap-3 border-t border-line bg-canvas/40 px-5 py-3">
          {isManual && (
            <form
              action={async (formData) => {
                await updateManualValueAction(formData);
                onMutated?.();
              }}
              className={`flex flex-1 items-end gap-2 ${FIELD_CONTROL}`}
            >
              <input type="hidden" name="holdingId" value={item.holding.id} />
              <label className="grid max-w-[200px] flex-1 gap-1.5">
                <span className="eyebrow">
                  Value ({item.holding.quoteCurrency ?? currency})
                </span>
                <input
                  name="manualValue"
                  type="number"
                  step="any"
                  defaultValue={item.holding.manualValue ?? 0}
                  required
                />
              </label>
              <Button type="submit" variant="secondary">
                Save
              </Button>
            </form>
          )}
          {!isDerived && (
            <form
              action={async (formData) => {
                await deleteHoldingAction(formData);
                onMutated?.();
              }}
              className="ml-auto"
            >
              <input type="hidden" name="holdingId" value={item.holding.id} />
              <Button type="submit" variant="danger">
                Delete
              </Button>
            </form>
          )}
        </div>
      )}

      {lots.length > 0 && (
        <details className="group border-t border-line bg-canvas/40">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[11px] font-bold transition-colors duration-150 hover:bg-elevated [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-baseline gap-2 uppercase tracking-[0.04em]">
              Purchases
              <em className="text-[11px] font-semibold normal-case not-italic tracking-normal text-dim">
                {lots.length} {lots.length === 1 ? "lot" : "lots"}
              </em>
            </span>
            <span
              aria-hidden="true"
              className="inline-block size-2 rotate-45 border-b-2 border-r-2 border-dim transition-transform duration-150 group-open:rotate-[225deg]"
            />
          </summary>
          <DataTable
            head={
              <tr>
                <th>Bought</th>
                <th className="numeric">Units @ price</th>
                <th className="numeric">Fees</th>
              </tr>
            }
          >
            {lots.map((lot) => (
              <tr key={lot.id}>
                <td className="whitespace-nowrap text-dim">
                  {formatDate(lot.purchasedAt)}
                </td>
                <td className="numeric">
                  <strong className="font-semibold text-text">
                    {formatQuantity(lot.quantity)}
                  </strong>
                  <span className="text-faint"> @ </span>
                  {formatMoney(lot.costPerUnit, lot.costCurrency)}
                </td>
                <td className="numeric text-dim">
                  {formatMoney(lot.fees, lot.costCurrency)}
                </td>
              </tr>
            ))}
          </DataTable>
        </details>
      )}
    </article>
  );
}

const SECTIONS: Array<{
  type: HoldingType;
  title: string;
  eyebrow: string;
}> = [
  { type: "crypto", title: "Crypto", eyebrow: "Coins & tokens" },
  { type: "equity", title: "Stocks & ETFs", eyebrow: "Equities" },
  { type: "manual", title: "Manual", eyebrow: "Entered by you" },
];

export function HoldingsManager({
  holdings,
  lotsByHolding,
  currency,
  onMutated,
}: HoldingsManagerProps) {
  if (holdings.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-dim">
        No holdings yet. Use a form below to add your first asset.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {SECTIONS.map((section) => {
        const items = sortHoldings(
          holdings.filter((item) => item.holding.type === section.type),
        );
        if (items.length === 0) return null;

        return (
          <Card key={section.type} aria-label={section.title}>
            <SectionHeading
              eyebrow={section.eyebrow}
              title={section.title}
              meta={`${items.length} ${items.length === 1 ? "position" : "positions"}`}
            />
            {items.map((item) => (
              <HoldingCard
                key={item.holding.id}
                item={item}
                lots={sortLots(lotsByHolding[item.holding.id] ?? [])}
                currency={currency}
                onMutated={onMutated}
              />
            ))}
          </Card>
        );
      })}
    </div>
  );
}
