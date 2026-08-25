/**
 * Next runs this once per server process. The edge runtime has no SQLite, so
 * only the Node runtime starts the alert scheduler.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startAlertScheduler } = await import("@/lib/alerts/scheduler");
  startAlertScheduler();
}
