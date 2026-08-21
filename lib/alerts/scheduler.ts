import "server-only";

import { runAlertsNow } from "@/lib/alerts/run";

const DEFAULT_INTERVAL_MS = 600_000;
const MIN_INTERVAL_MS = 60_000;
/**
 * Node stores a timer delay in a signed 32-bit int; anything larger is clamped
 * to 1 ms, which would turn the scheduler into a tight loop hammering the
 * quote providers.
 */
const MAX_INTERVAL_MS = 2_147_483_647;
/** Let the server finish booting before the first pass. */
const FIRST_PASS_DELAY_MS = 30_000;

let started = false;

export function alertsSchedulerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.ALERTS_ENABLED === "1") return true;
  if (env.ALERTS_ENABLED === "0") return false;
  return env.NODE_ENV === "production";
}

export function alertsIntervalMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Math.trunc(Number(env.ALERTS_INTERVAL_MS));
  if (!Number.isFinite(raw) || raw < MIN_INTERVAL_MS) {
    return DEFAULT_INTERVAL_MS;
  }
  return Math.min(raw, MAX_INTERVAL_MS);
}

async function tick(): Promise<void> {
  try {
    const result = await runAlertsNow();
    if (result.skipped) {
      console.log(`[alerts] skipped: ${result.skipped}`);
      return;
    }
    console.log(
      `[alerts] checked ${result.checked}, fired ${result.fired}, errors ${result.errors}`,
    );
  } catch (error) {
    console.error("[alerts] pass failed", error);
  }
}

/** Idempotent: a hot reload cannot stack intervals. */
export function startAlertScheduler(): void {
  if (started || !alertsSchedulerEnabled()) return;
  started = true;

  const intervalMs = alertsIntervalMs();
  console.log(`[alerts] scheduler on, every ${intervalMs / 1000}s`);

  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), intervalMs);
  }, FIRST_PASS_DELAY_MS);
}
