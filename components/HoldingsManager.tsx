"use client";

import {
  deleteHoldingAction,
  updateManualValueAction,
} from "@/app/actions/portfolio";
import type { HoldingType, Lot, ValuedHolding } from "@/lib/domain/types";

import { formatMoney, formatSignedMoney } from "./NetWorthHeader";

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
  const direction = pl == null ? "neutral" : pl >= 0 ? "gain" : "loss";

  return (
    <article className="managed-holding">
      <div className="managed-holding-summary">
        <div className="holding-identity">
          <span>{item.holding.symbol ?? "MAN"}</span>
          <p>{item.holding.name}</p>
        </div>
        <div className="managed-quantity">
          <span>Units</span>
          <strong>
            {item.holding.type === "manual"
              ? "—"
              : formatQuantity(item.quantity)}
          </strong>
        </div>
        <div className="holding-value">
          <strong>{formatMoney(item.currentValueBase, currency)}</strong>
          <span className={direction}>
            {pl == null ? "Manual value" : formatSignedMoney(pl, currency)}
          </span>
        </div>
      </div>

      <div className="managed-holding-actions">
        {item.holding.type === "manual" && (
          <form
            action={async (formData) => {
              await updateManualValueAction(formData);
              onMutated?.();
            }}
            className="manual-value-form"
          >
            <input type="hidden" name="holdingId" value={item.holding.id} />
            <label>
              Value ({item.holding.quoteCurrency ?? currency})
              <input
                name="manualValue"
                type="number"
                step="any"
                defaultValue={item.holding.manualValue ?? 0}
                required
              />
            </label>
            <button type="submit" className="secondary-button">
              Save
            </button>
          </form>
        )}
        <form
          action={async (formData) => {
            await deleteHoldingAction(formData);
            onMutated?.();
          }}
          className="delete-holding-form"
        >
          <input type="hidden" name="holdingId" value={item.holding.id} />
          <button type="submit" className="danger-button">
            Delete
          </button>
        </form>
      </div>

      {lots.length > 0 && (
        <details className="lots-disclosure">
          <summary>
            <span className="lots-summary-label">
              Purchases
              <em>
                {lots.length} {lots.length === 1 ? "lot" : "lots"}
              </em>
            </span>
            <span className="lots-chevron" aria-hidden="true" />
          </summary>
          <div className="lots-scroll">
            <table className="lots-table">
              <thead>
                <tr>
                  <th>Bought</th>
                  <th className="numeric">Units @ price</th>
                  <th className="numeric">Fees</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.id}>
                    <td>{formatDate(lot.purchasedAt)}</td>
                    <td className="numeric lots-fill">
                      <strong>{formatQuantity(lot.quantity)}</strong>
                      <span> @ </span>
                      {formatMoney(lot.costPerUnit, lot.costCurrency)}
                    </td>
                    <td className="numeric">
                      {formatMoney(lot.fees, lot.costCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      <p className="holdings-empty">
        No holdings yet. Use a form below to add your first asset.
      </p>
    );
  }

  return (
    <div className="managed-holdings">
      {SECTIONS.map((section) => {
        const items = sortHoldings(
          holdings.filter((item) => item.holding.type === section.type),
        );
        if (items.length === 0) return null;

        return (
          <section
            className="holdings-type-section"
            key={section.type}
            aria-label={section.title}
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">{section.eyebrow}</p>
                <h2>{section.title}</h2>
              </div>
              <span>
                {items.length} {items.length === 1 ? "position" : "positions"}
              </span>
            </div>
            {items.map((item) => (
              <HoldingCard
                key={item.holding.id}
                item={item}
                lots={sortLots(lotsByHolding[item.holding.id] ?? [])}
                currency={currency}
                onMutated={onMutated}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
