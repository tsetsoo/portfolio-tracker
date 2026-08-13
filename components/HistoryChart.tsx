"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface HistoryChartProps {
  snapshots: { date: string; totalBase: number }[];
  currency: string;
}

const GAIN = "#3fdd8a";
const DIM = "#8494a6";

function compactMoney(value: number, currency: string): string {
  const code = currency.trim().toUpperCase() || "USD";
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value)} ${code}`;
  }
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function HistoryChart({ snapshots, currency }: HistoryChartProps) {
  if (snapshots.length < 2) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-3 p-5 text-center sm:h-[260px] lg:h-[290px]">
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-full border border-dashed border-line-strong font-mono text-dim"
        >
          —
        </span>
        <p className="text-xs text-dim">
          Portfolio history will appear after two daily snapshots.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[220px] py-4 pr-3 sm:h-[260px] lg:h-[290px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={snapshots}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        >
          <defs>
            <linearGradient id="history-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GAIN} stopOpacity={0.22} />
              <stop offset="100%" stopColor={GAIN} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={40}
            tick={{ fill: DIM, fontSize: 11 }}
            tickFormatter={formatDay}
          />
          <YAxis
            hide
            domain={["dataMin", "dataMax"]}
            padding={{ top: 20, bottom: 20 }}
          />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.18)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload && payload.length > 0 ? (
                <div className="rounded-lg border border-line-strong bg-elevated px-3 py-2 shadow-lg">
                  <p className="eyebrow">
                    {new Intl.DateTimeFormat("en", {
                      dateStyle: "medium",
                    }).format(new Date(`${String(label)}T00:00:00`))}
                  </p>
                  <p className="mt-1 font-mono text-sm tabular-nums text-text">
                    {compactMoney(Number(payload[0].value), currency)}
                  </p>
                </div>
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="totalBase"
            stroke={GAIN}
            strokeWidth={2}
            fill="url(#history-fill)"
            activeDot={{
              r: 3.5,
              fill: GAIN,
              stroke: "#0a0e14",
              strokeWidth: 2,
            }}
            animationDuration={450}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
