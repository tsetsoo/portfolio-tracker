import { describe, expect, it } from "vitest";

import { windowFrom } from "@/components/HistoryCard";

const snap = (date: string) => ({ date, totalBase: 1 });

describe("windowFrom", () => {
  it("returns everything for ALL", () => {
    const all = [snap("2026-01-01"), snap("2026-08-01")];
    expect(windowFrom(all, "ALL")).toHaveLength(2);
  });

  it("anchors the window to the newest snapshot, not to now", () => {
    // A series that stopped months ago must still show its own tail rather
    // than collapsing to empty.
    const stale = [snap("2020-01-01"), snap("2020-01-20"), snap("2020-02-01")];
    expect(windowFrom(stale, "1M").map((s) => s.date)).toEqual([
      "2020-01-20",
      "2020-02-01",
    ]);
  });

  it("excludes points older than the window", () => {
    const series = [snap("2026-01-01"), snap("2026-07-20"), snap("2026-08-01")];
    expect(windowFrom(series, "1M").map((s) => s.date)).toEqual([
      "2026-07-20",
      "2026-08-01",
    ]);
    expect(windowFrom(series, "1Y")).toHaveLength(3);
  });

  it("handles an empty series", () => {
    expect(windowFrom([], "1M")).toEqual([]);
    expect(windowFrom([], "ALL")).toEqual([]);
  });

  it("can return a single point, which the caller uses to disable the range", () => {
    const series = [snap("2026-01-01"), snap("2026-08-01")];
    expect(windowFrom(series, "1M")).toHaveLength(1);
  });
});
