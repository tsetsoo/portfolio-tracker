import type Database from "better-sqlite3";

/**
 * How long a claimed lock is honoured before it is treated as abandoned.
 *
 * Half the scheduler's default tick interval (600_000 ms, see
 * lib/alerts/scheduler.ts). Equity quotes are fetched sequentially with no
 * fetch timeout anywhere in the app, so a real pass can legitimately run
 * for a while; 300_000 ms is comfortably longer than that for the handful
 * of alerts this app expects. It is still short enough that if the process
 * is killed mid-pass — the one case that can leave the row claimed with
 * nothing left alive to release it — the lease has already expired before
 * the next scheduled tick fires, instead of wedging every alert until a
 * human notices.
 */
export const DEFAULT_LEASE_MS = 300_000;

/**
 * Claims the single-row alert_pass_lock, atomically with respect to any
 * other connection open on the same database file (see
 * lib/db/client.ts — Next's webpack layers mean several such connections
 * really do exist in one process). The read-then-claim happens inside an
 * IMMEDIATE transaction, which takes SQLite's write lock up front so two
 * connections racing to claim cannot both see the row as free.
 *
 * Returns the `locked_until` value written on success (the caller's fencing
 * token — see `releasePassLock`), or `null` if another holder's lease is
 * still current.
 */
export function acquirePassLock(
  db: Database.Database,
  now: Date,
  leaseMs: number = DEFAULT_LEASE_MS,
): string | null {
  const nowIso = now.toISOString();
  const untilIso = new Date(now.getTime() + leaseMs).toISOString();

  const claim = db.transaction(() => {
    const row = db
      .prepare(`SELECT locked_until FROM alert_pass_lock WHERE id = 1`)
      .get() as { locked_until: string | null } | undefined;

    if (row?.locked_until && row.locked_until > nowIso) return null;

    db.prepare(
      `INSERT INTO alert_pass_lock (id, locked_until) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET locked_until = excluded.locked_until`,
    ).run(untilIso);
    return untilIso;
  });

  return claim.immediate();
}

/**
 * Releases the lock, but only if it still holds the lease this caller
 * claimed. `token` is the `locked_until` value `acquirePassLock` returned;
 * it doubles as a fencing token because a lease can only be re-claimed after
 * the previous one has expired, so a later acquirer's `locked_until` is
 * necessarily different from this caller's.
 *
 * Without this check, a pass that outlives its own lease (there is no fetch
 * timeout on quote requests, so this is reachable, not theoretical) would
 * clear a lease a second pass has since legitimately claimed, letting a
 * third pass start while the second is still running — exactly the overlap
 * this lock exists to prevent. Do not "simplify" this back to an
 * unconditional UPDATE.
 *
 * Returns whether this call actually cleared the lock.
 */
export function releasePassLock(db: Database.Database, token: string): boolean {
  const result = db
    .prepare(
      `UPDATE alert_pass_lock SET locked_until = NULL WHERE id = 1 AND locked_until = ?`,
    )
    .run(token);
  return result.changes > 0;
}
