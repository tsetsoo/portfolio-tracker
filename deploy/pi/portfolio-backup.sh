#!/usr/bin/env bash
set -euo pipefail
# Daily encrypted off-device backup of the portfolio database.
#
# Make a consistent copy, encrypt it, upload it, prune both ends. That is all.
#
# Why not just rsync the data directory: the app writes to the database on every
# dashboard load, and in rollback-journal mode SQLite modifies the file in place
# during a transaction. A raw copy taken mid-write is a corrupt database. Going
# through SQLite's backup API costs one python3 call — the stdlib module is on
# the host, so this needs nothing installed and nothing from the app container.
#
# Why encrypted: this is financial data going to a third party, and it is
# encrypted to a *public* key, so the Pi cannot read its own backups. A
# compromise of the Pi or of the bucket leaks nothing. The corollary is that
# losing the private key loses the backups — see docs/runbooks/offsite-backup.md.
#
# Fails loudly on purpose: a backup that reports success while writing nothing
# is worse than no backup at all.

CONFIG="${PORTFOLIO_BACKUP_CONFIG:-/etc/portfolio-backup.env}"
# shellcheck source=/dev/null
[[ -f "$CONFIG" ]] && source "$CONFIG"

DB="${DB:-/opt/portfolio/data/portfolio.db}"
LOCAL_DIR="${LOCAL_DIR:-/opt/portfolio/data/backups}"
RCLONE="${RCLONE:-/opt/portfolio/bin/rclone}"
# In a directory pi owns, not /opt/portfolio, which is root-owned. rclone saves
# config by writing a temp file *beside* it and renaming, so a pi-writable file
# in a root-owned directory is not enough — and Drive refreshes its token and
# writes it back on a schedule, so this would fail nightly, not just at setup.
RCLONE_CONFIG_FILE="${RCLONE_CONFIG_FILE:-/opt/portfolio/rclone.d/rclone.conf}"
REMOTE="${REMOTE:-}"                  # rclone remote:path, e.g. s3:my-bucket/portfolio
GPG_RECIPIENT="${GPG_RECIPIENT:-}"    # fingerprint of the backup PUBLIC key
KEEP_LOCAL="${KEEP_LOCAL:-14}"
# A year of daily copies is ~150MB at 420KB each — pennies, and a far better
# tail than a monthly tier with its own code to get wrong.
KEEP_REMOTE="${KEEP_REMOTE:-365}"

log() { echo "backup: $*"; }
die() { echo "backup: $*" >&2; exit 1; }

[[ -f "$DB" ]] || die "no database at $DB"

# The upload is optional so that a box with no bucket configured still gets a
# verified local backup every night, rather than nothing at all. Configure
# REMOTE and GPG_RECIPIENT to get the copy off the device — which is the point,
# since a local copy dies with the SD card. See docs/runbooks/offsite-backup.md.
upload=1
if [[ -z "$REMOTE" || -z "$GPG_RECIPIENT" ]]; then
  upload=0
fi

if (( upload )); then
  [[ -x "$RCLONE" ]] || die "rclone not found at $RCLONE"
  [[ -r "$RCLONE_CONFIG_FILE" ]] || die "$RCLONE_CONFIG_FILE not readable by $(id -un)"
  # The secret key must never live on the box it protects, or encrypting to a
  # public key is pointless — and it would be pointless invisibly.
  if gpg --list-secret-keys "$GPG_RECIPIENT" >/dev/null 2>&1; then
    die "the SECRET key for $GPG_RECIPIENT is on this host; remove it with 'gpg --delete-secret-keys $GPG_RECIPIENT'"
  fi
  gpg --list-keys "$GPG_RECIPIENT" >/dev/null 2>&1 \
    || die "public key $GPG_RECIPIENT not in this keyring"
fi

# rclone v1.75.0 on armv7 prints ~18 cosmetic "no overview data found" lines at
# ERROR level per invocation. Unfiltered they would bury a real error in the
# nightly journal, which defeats failing loudly. Filtered synchronously so the
# real stderr always survives, and rclone's exit status is preserved.
rc() {
  local err status=0
  err="$(mktemp)"
  "$RCLONE" --config "$RCLONE_CONFIG_FILE" "$@" 2>"$err" || status=$?
  grep -v 'internal error: no overview data found for' "$err" >&2 || true
  rm -f "$err"
  return "$status"
}

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"
# One run at a time; the timer and a hand-run must not interleave.
exec 9>"$LOCAL_DIR/.lock"
flock -n 9 || die "another backup is already running"

name="portfolio-$(date +%F-%H%M%S).db"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Consistent copy, then prove it opens and is intact before it counts for
# anything. Both happen in one python3 call against the host's stdlib sqlite3.
python3 - "$DB" "$work/$name" <<'PY' || die "copy or verification failed"
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect("file:%s?mode=ro" % src, uri=True)
d = sqlite3.connect(dst)
s.backup(d)
d.close(); s.close()
c = sqlite3.connect("file:%s?mode=ro" % dst, uri=True)
ok = c.execute("PRAGMA integrity_check").fetchone()[0]
if ok != "ok":
    raise SystemExit("integrity_check: %s" % ok)
n, newest = c.execute("SELECT COUNT(*), MAX(date) FROM snapshots").fetchone()
print("backup: verified — %d snapshots, newest %s" % (n, newest))
c.close()
PY

# Keep the plaintext copy locally too — it makes a quick restore trivial and it
# never leaves the box.
install -m 600 "$work/$name" "$LOCAL_DIR/$name"

if (( upload )); then
  # Encrypt. --trust-model always because this is our own backup key, pinned by
  # fingerprint in the config rather than signed into a web of trust.
  gpg --batch --yes --quiet --trust-model always --recipient "$GPG_RECIPIENT" \
      --output "$work/$name.gpg" --encrypt "$work/$name" \
    || die "encryption failed"
  if head -c 16 "$work/$name.gpg" | grep -qa "SQLite format 3"; then
    die "refusing to upload: output still looks like a plain database"
  fi

  rc copyto "$work/$name.gpg" "$REMOTE/$name.gpg" || die "upload to $REMOTE failed"
  # Trust the far end's listing, not rclone's exit code: the failure worth
  # catching is an upload that reports success while writing nowhere.
  rc lsf "$REMOTE/$name.gpg" | grep -q . \
    || die "$name.gpg is not at $REMOTE after a reported successful upload"
  log "uploaded $name.gpg ($(stat -c %s "$work/$name.gpg") bytes)"
else
  log "no REMOTE configured — local copy only, nothing is off the device yet"
fi

# Prune. Names are portfolio-YYYY-MM-DD-HHMMSS, so they sort chronologically
# and the oldest are at the front.
ls -1 "$LOCAL_DIR"/portfolio-*.db 2>/dev/null | sort | head -n "-$KEEP_LOCAL" \
  | xargs -r rm -f
n_local="$(ls -1 "$LOCAL_DIR"/portfolio-*.db 2>/dev/null | wc -l | tr -d ' ' || true)"

if (( upload )); then
  remote_old="$(rc lsf "$REMOTE" | grep '^portfolio-.*\.db\.gpg$' | sort | head -n "-$KEEP_REMOTE" || true)"
  if [[ -n "$remote_old" ]]; then
    while read -r old; do
      rc deletefile "$REMOTE/$old" || die "could not prune $old — remote retention is not being enforced"
    done <<< "$remote_old"
  fi
  n_remote="$(rc lsf "$REMOTE" | grep -c '\.db\.gpg$' || true)"
  log "ok — $n_local local, $n_remote remote"
else
  log "ok — $n_local local"
fi
