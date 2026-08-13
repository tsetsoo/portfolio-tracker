export type Direction = "gain" | "loss" | "neutral";

export function directionOf(value: number | null | undefined): Direction {
  if (value == null) return "neutral";
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "neutral";
}

const TONE: Record<Direction, string> = {
  gain: "text-gain",
  loss: "text-loss",
  neutral: "text-dim",
};

const PILL: Record<Direction, string> = {
  gain: "bg-gain/10 text-gain",
  loss: "bg-loss/10 text-loss",
  neutral: "bg-elevated text-dim",
};

const ARROW: Record<Direction, string> = {
  gain: "▲",
  loss: "▼",
  neutral: "—",
};

export function toneClass(direction: Direction): string {
  return TONE[direction];
}

/** Rounded P&L badge: arrow, absolute figure, optional percentage. */
export function DeltaPill({
  direction,
  value,
  percent,
}: {
  direction: Direction;
  value: string;
  percent?: number | null;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs tabular-nums ${PILL[direction]}`}
    >
      <span aria-hidden="true" className="text-[9px]">
        {ARROW[direction]}
      </span>
      {value}
      {percent != null && (
        <span className="opacity-70">
          {percent > 0 ? "+" : ""}
          {percent.toFixed(2)}%
        </span>
      )}
    </span>
  );
}
