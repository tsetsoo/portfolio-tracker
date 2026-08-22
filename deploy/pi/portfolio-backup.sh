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

log() { echo "portfolio-backup: $*"; }
die() { echo "portfolio-backup: $*" >&2; exit 1; }

# $DATA_DIR is mounted at /data inside the container. Derive the container's
# view of $BACKUP_DIR rather than hardcoding it: with a hardcoded /data/backups
# the *_DIR overrides would put the copy in one directory and its verification
# and rotation in another, which fails confusingly rather than loudly.
case "$BACKUP_DIR/" in
  "$DATA_DIR"/*) C_BACKUP="/data/${BACKUP_DIR#"$DATA_DIR"/}" ;;
  *) die "PORTFOLIO_BACKUP_DIR ($BACKUP_DIR) must live under PORTFOLIO_DATA_DIR ($DATA_DIR) — the container only has that mount" ;;
esac

# Local time, not UTC, deliberately. Snapshot rows are keyed by localDateString
# (app/api/snapshot/route.ts), so a UTC stamp would name the 00:30 BST backup
# with the previous day's date while it contains the current day's snapshot —
# the wrong file to reach for in a restore. The UK DST step is at 02:00, so a
# 00:30 daily never lands in the repeated hour.
stamp="$(date +%Y-%m-%d-%H%M%S)"
month="$(date +%Y-%m)"
name="portfolio-$stamp.db"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/monthly" "$BACKUP_DIR/archive"

[[ -f "$DATA_DIR/portfolio.db" ]] || die "no live database at $DATA_DIR/portfolio.db"

# --- wait for the container -------------------------------------------------
waited=0
until "$DOCKER" exec "$CONTAINER" true >/dev/null 2>&1; do
  if (( waited >= CONTAINER_WAIT )); then
    die "container '$CONTAINER' not exec-able after ${CONTAINER_WAIT}s; no sqlite available to make a consistent copy"
  fi
  (( waited == 0 )) && log "waiting for container '$CONTAINER'"
  sleep 5
  waited=$(( waited + 5 ))
done
(( waited > 0 )) && log "container ready after ${waited}s"

# --- copy + verify ----------------------------------------------------------
# Write to a staging name and rename in only after verification passes. A copy
# that fails verification must never be left where something else can find it:
# every consumer here and in portfolio-backup-offsite.sh picks "newest *.db in
# daily/", so an orphaned bad copy would both rotate good ones out and get
# encrypted and pushed off-device with an "ok" in the journal. The leading dot
# keeps the staging file out of those *.db globs while it is in flight.
staging=".incoming-$name"
cleanup_staging() { rm -f "$BACKUP_DIR/daily/$staging"; }
trap cleanup_staging EXIT

# One node invocation, so verification reads the copy this backup just wrote and
# live row counts are sampled either side of it: the app keeps serving during
# the backup, so a table may legitimately change mid-copy. The copy is a
# snapshot at some instant between the two samples, so any count *between* them
# is legitimate — only a count outside that range means we captured something
# that was never in the database.
"$DOCKER" exec "$CONTAINER" node -e '
const D = require("/app/node_modules/better-sqlite3");
const TABLES = ["holdings", "lots", "snapshots", "import_batches"];
const dest = process.argv[1];
const counts = (db) => Object.fromEntries(
  TABLES.map((t) => [t, db.prepare("SELECT COUNT(*) n FROM " + t).get().n]));

const live = new D("/data/portfolio.db", { readonly: true });
const before = counts(live);

live.backup(dest).then(() => {
  const after = counts(live);
  live.close();

  const copy = new D(dest, { readonly: true });
  const integrity = copy.pragma("integrity_check")[0].integrity_check;
  if (integrity !== "ok") throw new Error("integrity_check: " + integrity);
  const got = counts(copy);
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
  if (got.holdings === 0) throw new Error("copy has zero holdings; refusing to keep it");

  console.log("verified " + TABLES.map((t) => t + "=" + got[t]).join(" "));
}).catch((e) => { console.error("backup failed: " + e.message); process.exit(1); });
' "$C_BACKUP/daily/$staging" || die "copy or verification failed for $name (staging file discarded)"

[[ -s "$BACKUP_DIR/daily/$staging" ]] || die "$name is missing or empty after a reported success"
size="$(wc -c < "$BACKUP_DIR/daily/$staging" | tr -d ' ')"

# Verified. Publish it under its real name; from here it is a backup.
mv "$BACKUP_DIR/daily/$staging" "$BACKUP_DIR/daily/$name"
trap - EXIT
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
