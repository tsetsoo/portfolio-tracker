import { Card } from "./Card";
import { DeltaPill, type Direction } from "./Delta";

export function StatTile({
  label,
  value,
  share,
  delta,
}: {
  label: string;
  value: string;
  /** Fraction of the portfolio, 0–1. Renders a thin proportion bar. */
  share?: number;
  delta?: { value: string; percent?: number | null; direction: Direction };
}) {
  return (
    <Card className="p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-mono text-xl tabular-nums tracking-tight">
        {value}
      </p>

      {delta && (
        <div className="mt-2">
          <DeltaPill
            direction={delta.direction}
            value={delta.value}
            percent={delta.percent}
          />
        </div>
      )}

      {share != null && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-elevated">
            <div
              className="h-full rounded-full bg-text/40"
              style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }}
            />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-faint">
            {(share * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </Card>
  );
}
