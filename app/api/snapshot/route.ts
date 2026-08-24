import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/client";
import { localDateString } from "@/lib/portfolio/page-data";
import { ensureTodaySnapshot } from "@/lib/portfolio/snapshots";
import { valueOverviewPortfolio } from "@/lib/portfolio/value-portfolio";

export const dynamic = "force-dynamic";

/**
 * Records today's net-worth snapshot.
 *
 * Snapshots are otherwise written only when someone opens the dashboard, so any
 * unvisited day is missing from Portfolio history permanently:
 * ensureTodaySnapshot is first-write-wins per date and cannot backfill.
 * deploy/pi/portfolio-snapshot.timer calls this daily.
 *
 * POST, not GET: it writes, and the app has no auth, so a crawler or link
 * preview should not be able to mutate data.
 */
export async function POST() {
  try {
    // Fresh quotes, because a stale valuation must not be recorded as the day's
    // number — that is how a €0 or wrong day would get frozen in permanently.
    const valuation = await valueOverviewPortfolio(getDb(), {
      forceRefresh: true,
    });

    if (valuation.pricesOutdated) {
      // Fail loudly (curl -f -> unit failure -> visible in journalctl) instead
      // of reporting success while skipping the write.
      return NextResponse.json(
        {
          ok: false,
          reason: "prices stale after refresh; refusing to record the day",
        },
        { status: 503 },
      );
    }

    const date = localDateString(new Date());
    const inserted = ensureTodaySnapshot(getDb(), valuation, date);

    return NextResponse.json({
      ok: true,
      date,
      // false means the day already had a snapshot — first write wins.
      inserted,
      totalBase: valuation.totalBase,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
}
