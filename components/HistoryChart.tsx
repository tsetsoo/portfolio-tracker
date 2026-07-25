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

function compactMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function HistoryChart({ snapshots, currency }: HistoryChartProps) {
  if (snapshots.length < 2) {
    return (
      <div className="chart-empty">
        <span aria-hidden="true">—</span>
        <p>Portfolio history will appear after two daily snapshots.</p>
      </div>
    );
  }

  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={snapshots}
          margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id="history-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2f7554" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#2f7554" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={40}
            tick={{ fill: "#60727c", fontSize: 11 }}
            tickFormatter={(date: string) =>
              new Intl.DateTimeFormat("en", {
                month: "short",
                day: "numeric",
              }).format(new Date(`${date}T00:00:00`))
            }
          />
          <YAxis
            hide
            domain={["dataMin", "dataMax"]}
            padding={{ top: 20, bottom: 20 }}
          />
          <Tooltip
            formatter={(value) => [
              compactMoney(Number(value), currency),
              "Total",
            ]}
            labelFormatter={(date) =>
              new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                new Date(`${String(date)}T00:00:00`),
              )
            }
          />
          <Area
            type="monotone"
            dataKey="totalBase"
            stroke="#2f7554"
            strokeWidth={2}
            fill="url(#history-fill)"
            animationDuration={450}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
