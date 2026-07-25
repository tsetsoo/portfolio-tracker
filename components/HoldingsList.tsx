import type { ValuedHolding } from "@/lib/domain/types";

import { formatMoney, formatSignedMoney } from "./NetWorthHeader";

interface HoldingsListProps {
  holdings: ValuedHolding[];
  currency: string;
}

export function HoldingsList({ holdings, currency }: HoldingsListProps) {
  if (holdings.length === 0) {
    return (
      <p className="holdings-empty">
        No holdings yet. Add a holding to begin tracking your portfolio.
      </p>
    );
  }

  return (
    <ul className="holdings-list">
      {holdings.map((item) => {
        const pl = item.unrealizedPlBase;
        const direction = pl == null ? "neutral" : pl >= 0 ? "gain" : "loss";

        return (
          <li key={item.holding.id}>
            <div className="holding-identity">
              <span>{item.holding.symbol ?? "MAN"}</span>
              <p>{item.holding.name}</p>
            </div>
            <div className="holding-value">
              <strong>{formatMoney(item.currentValueBase, currency)}</strong>
              <span className={direction}>
                {pl == null ? "—" : formatSignedMoney(pl, currency)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
