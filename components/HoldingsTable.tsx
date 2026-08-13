import { formatMoney, formatSignedMoney } from "@/lib/format-money";
import { DataTable } from "@/components/ui/DataTable";
import { directionOf, toneClass } from "@/components/ui/Delta";
import type { ValuedHolding } from "@/lib/domain/types";

interface HoldingsTableProps {
  holdings: ValuedHolding[];
  currency: string;
  /** When given, each row shows its share of this total as a micro-bar. */
  totalBase?: number;
}

function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format(
    quantity,
  );
}

export function HoldingsTable({
  holdings,
  currency,
  totalBase,
}: HoldingsTableProps) {
  if (holdings.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-dim">
        No holdings yet. Add a holding to begin tracking your portfolio.
      </p>
    );
  }

  return (
    <DataTable
      head={
        <tr>
          <th>Holding</th>
          <th className="numeric">Units</th>
          <th className="numeric">Cost / unit</th>
          <th className="numeric">Price</th>
          <th className="numeric">Cost basis</th>
          <th className="numeric">Value</th>
          <th className="numeric">P&amp;L</th>
        </tr>
      }
    >
      {holdings.map((item) => {
        const pl = item.unrealizedPlBase;
        const direction = directionOf(pl);
        const spotPrice =
          item.quantity > 0 ? item.currentValueBase / item.quantity : null;
        const share =
          totalBase && totalBase > 0 ? item.currentValueBase / totalBase : null;

        return (
          <tr key={item.holding.id}>
            <td>
              <strong className="block font-mono text-xs font-semibold">
                {item.holding.symbol ?? "MAN"}
              </strong>
              <span className="mt-0.5 block max-w-[220px] truncate text-[10px] text-dim">
                {item.holding.name}
              </span>
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
            <td className="numeric font-semibold text-text">
              {formatMoney(item.currentValueBase, currency)}
              {share != null && (
                <span
                  className="mt-1.5 ml-auto block h-[3px] w-14 overflow-hidden rounded-full bg-elevated"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full bg-text/30"
                    style={{ width: `${Math.min(100, share * 100)}%` }}
                  />
                </span>
              )}
            </td>
            <td className={`numeric ${toneClass(direction)}`}>
              {pl == null ? "—" : formatSignedMoney(pl, currency)}
              {item.unrealizedPlPct != null && (
                <span className="mt-0.5 block text-[9px] opacity-80">
                  {item.unrealizedPlPct > 0 ? "+" : ""}
                  {item.unrealizedPlPct.toFixed(2)}%
                </span>
              )}
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}
