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
 * Returns true if the lock was claimed (or re-claimed after its previous
 * lease expired), false if another holder's lease is still current.
 */
export function acquirePassLock(
  db: Database.Database,
  now: Date,
  leaseMs: number = DEFAULT_LEASE_MS,
): boolean {
  const nowIso = now.toISOString();
  const untilIso = new Date(now.getTime() + leaseMs).toISOString();

  const claim = db.transaction(() => {
    const row = db
      .prepare(`SELECT locked_until FROM alert_pass_lock WHERE id = 1`)
      .get() as { locked_until: string | null } | undefined;

    if (row?.locked_until && row.locked_until > nowIso) return false;

    db.prepare(
      `INSERT INTO alert_pass_lock (id, locked_until) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET locked_until = excluded.locked_until`,
    ).run(untilIso);
    return true;
  });

  return claim.immediate();
}

/** Releases the lock unconditionally. Callers must do this in a `finally`. */
export function releasePassLock(db: Database.Database): void {
  db.prepare(`UPDATE alert_pass_lock SET locked_until = NULL WHERE id = 1`).run();
}
