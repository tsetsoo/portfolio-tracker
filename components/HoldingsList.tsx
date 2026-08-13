import { formatMoney, formatSignedMoney } from "@/lib/format-money";
import { directionOf, toneClass } from "@/components/ui/Delta";
import type { ValuedHolding } from "@/lib/domain/types";

interface HoldingsListProps {
  holdings: ValuedHolding[];
  currency: string;
}

export function HoldingsList({ holdings, currency }: HoldingsListProps) {
  if (holdings.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-dim">
        No holdings yet. Add a holding to begin tracking your portfolio.
      </p>
    );
  }

  return (
    <ul>
      {holdings.map((item) => {
        const pl = item.unrealizedPlBase;
        const direction = directionOf(pl);

        return (
          <li
            key={item.holding.id}
            className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5 last:border-b-0"
          >
            <div className="min-w-0">
              <span className="font-mono text-[13px] font-semibold">
                {item.holding.symbol ?? "MAN"}
              </span>
              <p className="mt-0.5 max-w-[190px] truncate text-[11px] text-dim">
                {item.holding.name}
              </p>
            </div>
            <div className="grid justify-items-end">
              <strong className="font-mono text-[13px] font-semibold tabular-nums">
                {formatMoney(item.currentValueBase, currency)}
              </strong>
              <span
                className={`mt-0.5 font-mono text-[10px] tabular-nums ${toneClass(direction)}`}
              >
                {pl == null ? "—" : formatSignedMoney(pl, currency)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
