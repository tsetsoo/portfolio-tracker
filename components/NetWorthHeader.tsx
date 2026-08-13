import { formatMoney, formatSignedMoney } from "@/lib/format-money";
import { Card } from "@/components/ui/Card";
import { DeltaPill, directionOf } from "@/components/ui/Delta";

interface NetWorthHeaderProps {
  total: number;
  profitLoss: number;
  profitLossPct?: number | null;
  currency: string;
  asOf: string;
}

export function NetWorthHeader({
  total,
  profitLoss,
  profitLossPct,
  currency,
  asOf,
}: NetWorthHeaderProps) {
  const direction = directionOf(profitLoss);

  return (
    <Card as="div" className="p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="eyebrow">Total portfolio</p>
          <p className="mt-3 font-mono text-[clamp(38px,9vw,64px)] font-medium leading-[1] tracking-[-0.04em]">
            {formatMoney(total, currency)}
          </p>
          <p className="mt-3 text-[11px] text-faint">
            Valued{" "}
            {new Intl.DateTimeFormat("en", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(asOf))}
          </p>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className="eyebrow">Unrealized P&amp;L</span>
          <DeltaPill
            direction={direction}
            value={formatSignedMoney(profitLoss, currency)}
            percent={profitLossPct}
          />
        </div>
      </div>
    </Card>
  );
}
