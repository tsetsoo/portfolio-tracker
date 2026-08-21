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

# $DATA_DIR is mounted at /data inside the container.
C_DATA="/data"

log() { echo "portfolio-backup: $*"; }
die() { echo "portfolio-backup: $*" >&2; exit 1; }

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
# One node invocation, so verification reads the copy this backup just wrote and
# live row counts are sampled either side of it: the app keeps serving during
# the backup, so a table may legitimately grow mid-copy. A copy matching either
# sample is consistent; one matching neither is not.
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

  const bad = TABLES.filter((t) => got[t] !== before[t] && got[t] !== after[t]);
  if (bad.length) {
    throw new Error("row counts match neither sample: " + bad
      .map((t) => t + " copy=" + got[t] + " live=" + before[t] + ".." + after[t]).join(", "));
  }
  if (got.holdings === 0) throw new Error("copy has zero holdings; refusing to keep it");

  console.log("verified " + TABLES.map((t) => t + "=" + got[t]).join(" "));
}).catch((e) => { console.error("backup failed: " + e.message); process.exit(1); });
' "$C_DATA/backups/daily/$name" || die "copy or verification failed for $name"

[[ -s "$BACKUP_DIR/daily/$name" ]] || die "$name is missing or empty after a reported success"
size="$(wc -c < "$BACKUP_DIR/daily/$name" | tr -d ' ')"
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
shopt -s nullglob
for legacy in "$DATA_DIR"/portfolio.pre-*.db "$DATA_DIR"/portfolio.db.bak-*; do
  if mv -n "$legacy" "$BACKUP_DIR/archive/"; then
    moved=$(( moved + 1 ))
  fi
done
shopt -u nullglob
if (( moved > 0 )); then
  log "moved $moved legacy copies into backups/archive/"
fi

# --- rotate ----------------------------------------------------------------
prune() {
  local dir="$1" keep="$2" pruned=0 old
  while read -r old; do
    [[ -n "$old" ]] || continue
    rm -f "$old" && pruned=$(( pruned + 1 ))
  done < <(ls -1dt "$dir"/*.db 2>/dev/null | tail -n +"$(( keep + 1 ))")
  if (( pruned > 0 )); then
    log "pruned $pruned from $(basename "$dir")/ (keeping $keep)"
  fi
  return 0
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"

n_daily="$(ls -1 "$BACKUP_DIR"/daily/*.db 2>/dev/null | wc -l | tr -d ' ')"
n_monthly="$(ls -1 "$BACKUP_DIR"/monthly/*.db 2>/dev/null | wc -l | tr -d ' ')"
log "ok — $n_daily daily, $n_monthly monthly"
