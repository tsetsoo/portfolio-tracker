interface NetWorthHeaderProps {
  total: number;
  profitLoss: number;
  profitLossPct?: number | null;
  currency: string;
  asOf: string;
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedMoney(value: number, currency: string): string {
  const amount = formatMoney(Math.abs(value), currency);
  if (value > 0) return `+${amount}`;
  if (value < 0) return `−${amount}`;
  return amount;
}

export function NetWorthHeader({
  total,
  profitLoss,
  profitLossPct,
  currency,
  asOf,
}: NetWorthHeaderProps) {
  const direction =
    profitLoss > 0 ? "gain" : profitLoss < 0 ? "loss" : "neutral";

  return (
    <header className="net-worth-header">
      <div>
        <p className="eyebrow">Total portfolio</p>
        <h1>{formatMoney(total, currency)}</h1>
        <p className="as-of">
          Valued {new Intl.DateTimeFormat("en", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(asOf))}
        </p>
      </div>
      <div className={`pl-summary ${direction}`}>
        <span>Unrealized P&amp;L</span>
        <strong>{formatSignedMoney(profitLoss, currency)}</strong>
        {profitLossPct != null && (
          <small>
            {profitLossPct > 0 ? "+" : ""}
            {profitLossPct.toFixed(2)}%
          </small>
        )}
      </div>
    </header>
  );
}

export { formatMoney, formatSignedMoney };
