import { NextResponse } from "next/server";

import { runAlertsNow } from "@/lib/alerts/run";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await runAlertsNow();
  return NextResponse.json(result);
}
