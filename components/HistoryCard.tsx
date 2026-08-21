"use client";

import { useMemo, useState } from "react";

import { HistoryChart } from "@/components/HistoryChart";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  RANGE_DAYS,
  RangeToggle,
  type RangeKey,
} from "@/components/ui/RangeToggle";

type Snapshot = { date: string; totalBase: number };

export function windowFrom(snapshots: Snapshot[], range: RangeKey): Snapshot[] {
  if (range === "ALL" || snapshots.length === 0) return snapshots;
  // Anchor to the newest snapshot, not to now: a stale series should still show
  // its own tail rather than collapsing to empty.
  const newest = snapshots[snapshots.length - 1].date;
  const cutoff = new Date(`${newest}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
  // Format from local parts, not toISOString(): the date is parsed as local
  // midnight, so converting to UTC shifts it a day in any UTC+ zone and the
  // window silently comes out one day too wide.
  const y = cutoff.getFullYear();
  const m = String(cutoff.getMonth() + 1).padStart(2, "0");
  const d = String(cutoff.getDate()).padStart(2, "0");
  const from = `${y}-${m}-${d}`;
  return snapshots.filter((s) => s.date >= from);
}

export function HistoryCard({
  snapshots,
  currency,
}: {
  snapshots: Snapshot[];
  currency: string;
}) {
  const [range, setRange] = useState<RangeKey>("ALL");

  const { enabled, shown } = useMemo(() => {
    const keys: RangeKey[] = ["1M", "3M", "1Y", "ALL"];
    const enabled = Object.fromEntries(
      // The chart needs two points to draw a line, so a range with fewer is
      // offered as disabled rather than rendering an empty frame.
      keys.map((k) => [k, windowFrom(snapshots, k).length >= 2]),
    ) as Record<RangeKey, boolean>;
    return { enabled, shown: windowFrom(snapshots, range) };
  }, [snapshots, range]);

  return (
    <Card>
      <SectionHeading
        eyebrow="Daily close"
        title="Portfolio history"
        meta={
          <span className="inline-flex items-center gap-3">
            <span className="hidden sm:inline">
              {shown.length} of {snapshots.length}
            </span>
            <RangeToggle value={range} onChange={setRange} enabled={enabled} />
          </span>
        }
      />
      <HistoryChart snapshots={shown} currency={currency} />
    </Card>
  );
}
