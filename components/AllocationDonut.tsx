"use client";

import { Cell, Pie, PieChart, Tooltip } from "recharts";

import { formatMoney } from "@/lib/format-money";
import type { HoldingType } from "@/lib/domain/types";

/**
 * Allocation is part-to-whole magnitude, so the slices use one neutral hue
 * stepped by lightness rather than categorical colors — green and red stay
 * reserved for P&L. Steps validated against the card surface (#111823):
 * monotone lightness, adjacent dL >= 0.06, darkest step 2.93:1 vs surface.
 *
 * Colour is keyed to the asset class, never to slice size, so hiding or
 * reordering a class never repaints the others.
 */
const SLICE: Record<HoldingType, string> = {
  equity: "#e6edf5",
  crypto: "#8494a6",
  manual: "#55637a",
};

const SURFACE = "#111823";
const SIZE = 168;

export type AllocationSlice = {
  type: HoldingType;
  label: string;
  value: number;
  share: number;
};

export function AllocationDonut({
  slices,
  total,
  currency,
}: {
  slices: AllocationSlice[];
  total: number;
  currency: string;
}) {
  if (slices.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-xs text-dim">
        Allocation appears once holdings are valued.
      </p>
    );
  }

  return (
    <div className="p-5">
      {/* Fixed size with explicit PieChart dimensions rather than
          ResponsiveContainer: inside a grid column the container can measure 0
          on first paint and the ring collapses to a sliver. */}
      <div className="relative mx-auto h-[168px] w-[168px]">
        <PieChart width={SIZE} height={SIZE}>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            innerRadius={58}
            outerRadius={82}
            startAngle={90}
            endAngle={-270}
            /* 2px surface gap between segments */
            paddingAngle={2}
            stroke={SURFACE}
            strokeWidth={2}
            // Deterministic first paint: a grow animation on a ring just means the
            // card renders empty for the first frames, which is worse than no animation.
            isAnimationActive={false}
          >
            {slices.map((s) => (
              <Cell key={s.type} fill={SLICE[s.type]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as AllocationSlice;
              return (
                <div className="rounded-lg border border-line-strong bg-elevated px-3 py-2 shadow-lg">
                  <p className="eyebrow">{d.label}</p>
                  <p className="mt-1 font-mono text-sm tabular-nums text-text">
                    {formatMoney(d.value, currency)}
                  </p>
                  <p className="font-mono text-[10px] tabular-nums text-dim">
                    {(d.share * 100).toFixed(1)}% of portfolio
                  </p>
                </div>
              );
            }}
          />
        </PieChart>

        {/* The hole is the natural home for the whole it divides. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="eyebrow">Total</span>
          <span className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums">
            {formatMoney(total, currency)}
          </span>
        </div>
      </div>

      {/* Legend doubles as the numbers table, so identity is never colour-alone. */}
      <ul className="mt-5 grid gap-2">
        {slices.map((s) => (
          <li key={s.type} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: SLICE[s.type] }}
            />
            <span className="min-w-0 flex-1 truncate text-[11px] text-dim">
              {s.label}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-text">
              {formatMoney(s.value, currency)}
            </span>
            <span className="w-11 text-right font-mono text-[10px] tabular-nums text-faint">
              {(s.share * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
