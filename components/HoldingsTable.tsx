import type { ValuedHolding } from "@/lib/domain/types";

import { formatMoney, formatSignedMoney } from "./NetWorthHeader";

interface HoldingsTableProps {
  holdings: ValuedHolding[];
  currency: string;
}

function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format(
    quantity,
  );
}

export function HoldingsTable({ holdings, currency }: HoldingsTableProps) {
  if (holdings.length === 0) {
    return (
      <p className="holdings-empty">
        No holdings yet. Add a holding to begin tracking your portfolio.
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table className="holdings-table">
        <thead>
          <tr>
            <th>Holding</th>
            <th className="numeric">Units</th>
            <th className="numeric">Cost / unit</th>
            <th className="numeric">Price</th>
            <th className="numeric">Cost basis</th>
            <th className="numeric">Value</th>
            <th className="numeric">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((item) => {
            const pl = item.unrealizedPlBase;
            const direction =
              pl == null ? "neutral" : pl >= 0 ? "gain" : "loss";
            const spotPrice =
              item.quantity > 0 ? item.currentValueBase / item.quantity : null;

            return (
              <tr key={item.holding.id}>
                <td>
                  <strong>{item.holding.symbol ?? "MAN"}</strong>
                  <span>{item.holding.name}</span>
                </td>
                <td className="numeric">{formatQuantity(item.quantity)}</td>
                <td className="numeric">
                  {item.avgCostPerUnit == null
                    ? "—"
                    : formatMoney(item.avgCostPerUnit, currency)}
                </td>
                <td className="numeric">
                  {spotPrice == null || item.currentValueBase === 0
                    ? "—"
                    : formatMoney(spotPrice, currency)}
                </td>
                <td className="numeric">
                  {item.costBasisBase == null
                    ? "—"
                    : formatMoney(item.costBasisBase, currency)}
                </td>
                <td className="numeric strong">
                  {formatMoney(item.currentValueBase, currency)}
                </td>
                <td className={`numeric ${direction}`}>
                  {pl == null ? "—" : formatSignedMoney(pl, currency)}
                  {item.unrealizedPlPct != null && (
                    <span>
                      {item.unrealizedPlPct > 0 ? "+" : ""}
                      {item.unrealizedPlPct.toFixed(2)}%
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
