import { NextResponse } from "next/server";

import { runAlertsNow } from "@/lib/alerts/run";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runAlertsNow();
    return NextResponse.json(result);
  } catch (error) {
    // An infrastructure failure (DB locked, quote service exploding) should
    // read as JSON to whatever curl/cron is poking this, not a Next 500 page.
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
