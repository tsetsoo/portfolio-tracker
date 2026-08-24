"use client";

export type RangeKey = "1M" | "3M" | "1Y" | "ALL";

export const RANGE_DAYS: Record<Exclude<RangeKey, "ALL">, number> = {
  "1M": 30,
  "3M": 91,
  "1Y": 365,
};

/** Segmented control. Ranges without enough points to plot are disabled rather
 *  than hidden, so the set of choices stays stable as history accumulates. */
export function RangeToggle({
  value,
  onChange,
  enabled,
}: {
  value: RangeKey;
  onChange: (next: RangeKey) => void;
  enabled: Record<RangeKey, boolean>;
}) {
  const keys: RangeKey[] = ["1M", "3M", "1Y", "ALL"];

  return (
    <div
      role="group"
      aria-label="Chart range"
      className="inline-flex overflow-hidden rounded-lg border border-line"
    >
      {keys.map((key) => {
        const active = key === value;
        const usable = enabled[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            disabled={!usable}
            onClick={() => onChange(key)}
            title={usable ? undefined : "Not enough history yet"}
            className={
              "min-h-7 px-2.5 font-mono text-[10px] font-semibold tracking-wide transition-colors duration-150 " +
              "border-l border-line first:border-l-0 " +
              "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70 " +
              "disabled:cursor-not-allowed disabled:opacity-35 " +
              (active
                ? "bg-elevated text-text"
                : "text-faint hover:text-dim disabled:hover:text-faint")
            }
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}
