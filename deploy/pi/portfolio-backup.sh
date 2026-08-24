#!/usr/bin/env bash
set -euo pipefail
# Consistent, verified, rotated backup of the portfolio SQLite database.
#
# Why not cp: copying a live SQLite file can capture a torn write. This goes
# through better-sqlite3's backup API inside the running container, which is the
# only sqlite on this host — the sqlite3 CLI is not installed and the host Node
# is pinned at 18, so it cannot load the container's native module. See
# install-node.sh.
#
# Fails loudly on purpose. A backup that reports success while writing nothing
# is worse than no backup at all, so every copy is opened, integrity-checked and
# row-counted against the live database before it is allowed to count.

PORTFOLIO_ROOT="${PORTFOLIO_ROOT:-/opt/portfolio}"
DATA_DIR="${PORTFOLIO_DATA_DIR:-$PORTFOLIO_ROOT/data}"
BACKUP_DIR="${PORTFOLIO_BACKUP_DIR:-$DATA_DIR/backups}"
CONTAINER="${PORTFOLIO_CONTAINER:-portfolio-app}"
DOCKER="${PORTFOLIO_DOCKER:-docker}"
# Retention. 14 dailies covers a fortnight of "I broke it last week"; the
# monthlies are the long tail, since snapshot history cannot be backfilled.
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
# The update timer fires every 2 min and restarts the container on a new
# release, so the container can legitimately be mid-restart when we run.
CONTAINER_WAIT="${CONTAINER_WAIT:-120}"
# A deploy mid-copy kills the docker exec, so do not give up on the first try.
COPY_ATTEMPTS="${COPY_ATTEMPTS:-3}"
RETRY_DELAY="${RETRY_DELAY:-30}"
# Every docker call is bounded. A wedged docker daemon is a routine Pi failure
# and an unbounded `docker exec` would hang the unit in "activating" forever —
# never logged as failed, with the next night's run merged into the stuck job.
# Same reasoning as portfolio-snapshot.service's `curl --max-time`.
PROBE_TIMEOUT="${PROBE_TIMEOUT:-15}"
COPY_TIMEOUT="${COPY_TIMEOUT:-300}"

log() { echo "portfolio-backup: $*"; }
die() { echo "portfolio-backup: $*" >&2; exit 1; }

# $DATA_DIR is mounted at /data inside the container. Derive *both* container
# paths from the host ones rather than hardcoding either: hardcoding the
# destination let the *_DIR overrides put the copy in one directory and its
# verification in another, and hardcoding the source made an overridden
# DATA_DIR read the production database while validating a different file.
# Strip a trailing slash first so BACKUP_DIR == DATA_DIR is caught by the
# comparison below instead of yielding a mangled "/data//opt/..." path.
DATA_DIR="${DATA_DIR%/}"
BACKUP_DIR="${BACKUP_DIR%/}"

# run-container.sh hardcodes the mount as "$PORTFOLIO_ROOT/data:/data", so /data
# inside the container is always that directory no matter what DATA_DIR says.
# Pointing DATA_DIR elsewhere used to look supported while actually reading the
# production database and writing a staging file into the production backups —
# a dry run that quietly touched live data. Refuse it instead.
if [[ "$DATA_DIR" != "$PORTFOLIO_ROOT/data" ]]; then
  die "PORTFOLIO_DATA_DIR ($DATA_DIR) must be \$PORTFOLIO_ROOT/data ($PORTFOLIO_ROOT/data) — the container mount is fixed by run-container.sh, so any other value would read the live database while validating a different file"
fi
case "$BACKUP_DIR" in
  "$DATA_DIR"/?*) C_BACKUP="/data/${BACKUP_DIR#"$DATA_DIR"/}" ;;
  *) die "PORTFOLIO_BACKUP_DIR ($BACKUP_DIR) must be a directory strictly under PORTFOLIO_DATA_DIR ($DATA_DIR) — the container only has that mount" ;;
esac
C_DB="/data/portfolio.db"

# Local time, not UTC, so the filename's date matches the newest snapshot date
# inside the file — otherwise a restore reaches for the wrong day. That holds
# because snapshot rows are keyed by localDateString (app/api/snapshot/route.ts)
# against the *container's* clock, and run-container.sh passes the host
# timezone in as TZ. If that ever stops happening the container reverts to UTC,
# snapshot rows go back to being dated a day early, and this naming stops
# lining up — so the verification below logs the copy's newest snapshot date,
# making any such drift visible in the journal rather than silent.
# The UK DST step is at 02:00, so a 00:30 daily never lands in the repeated hour.
stamp="$(date +%Y-%m-%d-%H%M%S)"
month="$(date +%Y-%m)"
name="portfolio-$stamp.db"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/monthly" "$BACKUP_DIR/archive"
# 0700, not the umask default of 0755: these hold the financial database in the
# clear on a host shared with pihole, homebridge, nginx and uwsgi.
chmod 0700 "$BACKUP_DIR" "$BACKUP_DIR/daily" "$BACKUP_DIR/monthly" "$BACKUP_DIR/archive"

[[ -f "$DATA_DIR/portfolio.db" ]] || die "no live database at $DATA_DIR/portfolio.db"

# --- wait for the container -------------------------------------------------
wait_for_container() {
  local waited=0
  until timeout "$PROBE_TIMEOUT" "$DOCKER" exec "$CONTAINER" true >/dev/null 2>&1; do
    if (( waited >= CONTAINER_WAIT )); then
      die "container '$CONTAINER' not exec-able after ${CONTAINER_WAIT}s; no sqlite available to make a consistent copy"
    fi
    if (( waited == 0 )); then
      log "waiting for container '$CONTAINER'"
    fi
    sleep 5
    waited=$(( waited + 5 ))
  done
  if (( waited > 0 )); then
    log "container ready after ${waited}s"
  fi
}

# --- copy + verify ----------------------------------------------------------
# Write to a staging name and rename in only after verification passes. A copy
# that fails verification must never be left where something else can find it:
# every consumer here and in portfolio-backup-offsite.sh picks "newest *.db in
# daily/", so an orphaned bad copy would both rotate good ones out and get
# encrypted and pushed off-device with an "ok" in the journal. The leading dot
# keeps the staging file out of those *.db globs while it is in flight.
staging=".incoming-$name"
cleanup_staging() { rm -f "$BACKUP_DIR/daily/$staging"; }
# INT/TERM as well as EXIT: a systemctl stop or a start-timeout kill would
# otherwise leave the staging file behind, and being a dotfile it is invisible
# to every *.db glob here — including prune — so orphans would accumulate on the
# SD card indefinitely without ever being rotated out.
#
# The INT/TERM handler must exit, not just clean up: a bash trap returns to
# where it was interrupted, so without the exit a SIGTERM would delete the
# staging file and then carry on — treating the killed docker exec as a failed
# attempt, retrying, creating a second staging file, and possibly publishing a
# backup while systemd waited out TimeoutStopSec and then SIGKILLed it, leaving
# exactly the orphan this trap is supposed to prevent.
trap cleanup_staging EXIT
trap 'cleanup_staging; exit 143' INT TERM

# Sweep any staging files a previous hard kill left behind, for the same reason.
shopt -s nullglob dotglob
stale=( "$BACKUP_DIR"/daily/.incoming-*.db )
shopt -u nullglob dotglob
if (( ${#stale[@]} > 0 )); then
  rm -f "${stale[@]}"
  log "cleared ${#stale[@]} stale staging file(s) from a previous interrupted run"
fi

# One node invocation, so verification reads the copy this backup just wrote and
# live row counts are sampled either side of it: the app keeps serving during
# the backup, so a table may legitimately change mid-copy. The copy is a
# snapshot at some instant between the two samples, so any count *between* them
# is legitimate — only a count outside that range means we captured something
# that was never in the database.
copy_and_verify() {
  timeout "$COPY_TIMEOUT" "$DOCKER" exec "$CONTAINER" node -e '
const D = require("/app/node_modules/better-sqlite3");
// The tables whose loss actually hurts. holdings and lots can be rebuilt from
// broker CSVs; snapshots, the wallet tables and settings are hand-entered or
// unbackfillable, so they are the ones worth asserting on. price_cache and the
// fx tables are omitted deliberately — they are caches that refill themselves.
const TABLES = ["holdings", "lots", "snapshots", "import_batches",
                "wallets", "wallet_addresses", "wallet_transfers", "settings"];
const dest = process.argv[1];
const src = process.argv[2];
const counts = (db) => Object.fromEntries(
  TABLES.map((t) => [t, db.prepare("SELECT COUNT(*) n FROM " + t).get().n]));

const live = new D(src, { readonly: true });
const before = counts(live);

live.backup(dest).then(() => {
  const after = counts(live);
  live.close();

  const copy = new D(dest, { readonly: true });
  const integrity = copy.pragma("integrity_check")[0].integrity_check;
  if (integrity !== "ok") throw new Error("integrity_check: " + integrity);
  const got = counts(copy);
  const newestRow = copy.prepare("SELECT date FROM snapshots ORDER BY date DESC LIMIT 1").get();
  const copyNewestSnapshot = newestRow ? newestRow.date : null;
  copy.close();

  // A range, not equality against the two endpoints: an import landing mid-copy
  // can legitimately leave the copy holding a count between them, and rejecting
  // that would discard a perfectly good backup and fail the unit.
  const bad = TABLES.filter((t) =>
    got[t] < Math.min(before[t], after[t]) || got[t] > Math.max(before[t], after[t]));
  if (bad.length) {
    throw new Error("row counts outside the live range: " + bad
      .map((t) => t + " copy=" + got[t] + " live=" + before[t] + ".." + after[t]).join(", "));
  }
  // No separate "zero holdings" guard. An absolute one rejected every copy
  // forever on a legitimately empty portfolio (fresh install, or after a
  // reset), and a version relative to the live counts turned out to be dead
  // code: the range check above already rejects a copy that lost rows the live
  // database still has — verified, it reports
  // "holdings copy=0 live=20..20". The only case the extra guard would have
  // caught alone is holdings dropping to 0 *during* the copy, where 0 is
  // genuinely in range and rejecting it would discard a valid backup.

  // Newest snapshot date, so a drift between the filename date and what the
  // file actually contains (see the TZ note above) shows up in the journal.
  console.log("verified " + TABLES.map((t) => t + "=" + got[t]).join(" ")
    + (copyNewestSnapshot ? " newest-snapshot=" + copyNewestSnapshot : ""));
}).catch((e) => {
  // process.exitCode, not process.exit(): docker exec gives node a pipe, writes
  // to a pipe are async, and process.exit() would tear the process down before
  // this flushed — losing the one line that says *why* the copy was rejected
  // and leaving only the generic shell-side message in the journal.
  console.error("backup failed: " + e.message);
  process.exitCode = 1;
});
' "$C_BACKUP/daily/$staging" "$C_DB"
}

# Retry, because portfolio-update.timer fires every 2 minutes and restarts the
# container on a new release — which kills an in-flight docker exec. Without a
# retry that loses the whole night's backup: Persistent=true catches timer runs
# that were *missed*, not ones that ran and failed.
attempt=0
while :; do
  attempt=$(( attempt + 1 ))
  wait_for_container
  if copy_and_verify; then
    break
  fi
  cleanup_staging
  if (( attempt >= COPY_ATTEMPTS )); then
    die "copy or verification failed for $name after $attempt attempt(s) (staging file discarded)"
  fi
  log "attempt $attempt failed; retrying in ${RETRY_DELAY}s"
  sleep "$RETRY_DELAY"
done

[[ -s "$BACKUP_DIR/daily/$staging" ]] || die "$name is missing or empty after a reported success"
size="$(wc -c < "$BACKUP_DIR/daily/$staging" | tr -d ' ')"

# Verified. Publish it under its real name; from here it is a backup.
mv "$BACKUP_DIR/daily/$staging" "$BACKUP_DIR/daily/$name"
trap - EXIT INT TERM
# The database in the clear. This host also runs pihole, homebridge, nginx and
# uwsgi, so leaving it 0644 would let every local account read the full
# financial history — while the offsite half goes to real trouble to encrypt the
# same bytes before they leave the box.
chmod 0600 "$BACKUP_DIR/daily/$name"
log "wrote daily/$name ($size bytes)"

# --- promote the first backup of the month ---------------------------------
# Hardlink, so pruning the daily copy does not take the monthly with it.
shopt -s nullglob
monthlies=( "$BACKUP_DIR/monthly/portfolio-$month-"*.db )
shopt -u nullglob
if (( ${#monthlies[@]} == 0 )); then
  ln -f "$BACKUP_DIR/daily/$name" "$BACKUP_DIR/monthly/$name"
  log "promoted monthly/$name"
fi

# --- tidy the loose ad-hoc copies out of the live data directory -----------
# They were version history sitting next to the original, which is not a backup.
# Idempotent: after the first run there is nothing left to move.
moved=0
kept=0
shopt -s nullglob
for legacy in "$DATA_DIR"/portfolio.pre-*.db "$DATA_DIR"/portfolio.db.bak-*; do
  # `mv -n` exits 0 when it declines to clobber, so its status cannot tell us
  # whether anything moved. Check first, and leave a same-named archived copy
  # alone rather than overwriting history with it.
  if [[ -e "$BACKUP_DIR/archive/$(basename "$legacy")" ]]; then
    kept=$(( kept + 1 ))
    continue
  fi
  mv "$legacy" "$BACKUP_DIR/archive/"
  moved=$(( moved + 1 ))
done
shopt -u nullglob
if (( moved > 0 )); then
  log "moved $moved legacy copies into backups/archive/"
fi
if (( kept > 0 )); then
  log "left $kept legacy copies in place — archive/ already has a file of that name"
fi

# --- rotate ----------------------------------------------------------------
prune() {
  local dir="$1" keep="$2" pruned=0 old
  while read -r old; do
    [[ -n "$old" ]] || continue
    # Not `rm -f … && pruned++`: set -e exempts the left side of &&, so a failed
    # delete would go unlogged and unreported while local retention quietly
    # stopped being enforced.
    if ! rm -f "$old"; then
      die "failed to prune $old — local retention is not being enforced"
    fi
    pruned=$(( pruned + 1 ))
  done < <(ls -1dt "$dir"/*.db 2>/dev/null | tail -n +"$(( keep + 1 ))" || true)
  if (( pruned > 0 )); then
    log "pruned $pruned from $(basename "$dir")/ (keeping $keep)"
  fi
  return 0
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"

# `|| true` on both: an empty directory makes the glob fail to match, ls exits
# non-zero, and under pipefail that would abort the unit with no message after a
# backup that had already succeeded and been published. monthly/ is genuinely
# empty when KEEP_MONTHLY=0.
n_daily="$(ls -1 "$BACKUP_DIR"/daily/*.db 2>/dev/null | wc -l | tr -d ' ' || true)"
n_monthly="$(ls -1 "$BACKUP_DIR"/monthly/*.db 2>/dev/null | wc -l | tr -d ' ' || true)"
log "ok — $n_daily daily, $n_monthly monthly"
