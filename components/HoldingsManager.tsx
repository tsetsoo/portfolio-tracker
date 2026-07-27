import {
  deleteHoldingAction,
  updateManualValueAction,
} from "@/app/actions/portfolio";
import type { Lot, ValuedHolding } from "@/lib/domain/types";

import { formatMoney, formatSignedMoney } from "./NetWorthHeader";

interface HoldingsManagerProps {
  holdings: ValuedHolding[];
  lotsByHolding: Record<string, Lot[]>;
  currency: string;
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

export function HoldingsManager({
  holdings,
  lotsByHolding,
  currency,
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
      {holdings.map((item) => {
        const lots = sortLots(lotsByHolding[item.holding.id] ?? []);
        const pl = item.unrealizedPlBase;
        const direction = pl == null ? "neutral" : pl >= 0 ? "gain" : "loss";

        return (
          <article className="managed-holding" key={item.holding.id}>
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
                  action={updateManualValueAction}
                  className="manual-value-form"
                >
                  <input
                    type="hidden"
                    name="holdingId"
                    value={item.holding.id}
                  />
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
              <form action={deleteHoldingAction} className="delete-holding-form">
                <input type="hidden" name="holdingId" value={item.holding.id} />
                <button type="submit" className="danger-button">
                  Delete
                </button>
              </form>
            </div>

            {lots.length > 0 && (
              <details className="lots-disclosure" open>
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
      })}
    </div>
  );
}
