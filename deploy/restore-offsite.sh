#!/usr/bin/env bash
set -euo pipefail
# Restore drill: fetch an encrypted offsite backup, decrypt it, and prove the
# result is a usable database.
#
# Runs wherever the backup PRIVATE key lives — the developer's Mac, not the Pi.
# The Pi deliberately cannot do this.
#
# A backup nobody has ever restored is a hypothesis. Run this occasionally, and
# certainly before you ever need it for real.
#
#   ./deploy/restore-offsite.sh                          # newest daily
#   ./deploy/restore-offsite.sh portfolio-2026-08-22-003020.db.gpg
#   ./deploy/restore-offsite.sh monthly/portfolio-2026-07-01-003012.db.gpg
#   ./deploy/restore-offsite.sh ~/Downloads/some.db.gpg   # a local file
#
# Env: OFFSITE_REMOTE (rclone remote:path), RESTORE_DIR (default ./data/restore)

OFFSITE_REMOTE="${OFFSITE_REMOTE:-}"
RESTORE_DIR="${RESTORE_DIR:-./data/restore}"
RCLONE="${RCLONE:-rclone}"

die() { echo "restore: $*" >&2; exit 1; }

command -v gpg >/dev/null || die "gpg not found (brew install gnupg)"
command -v sqlite3 >/dev/null || die "sqlite3 not found"

mkdir -p "$RESTORE_DIR"
arg="${1:-}"

if [[ -n "$arg" && -f "$arg" ]]; then
  enc="$arg"
  echo "restore: using local file $enc"
else
  command -v "$RCLONE" >/dev/null || die "rclone not found (brew install rclone), or pass a local .gpg path"
  [[ -n "$OFFSITE_REMOTE" ]] || die "set OFFSITE_REMOTE to the rclone remote:path holding the backups"

  # The remote mirrors the Pi: daily/ holds the rolling copies, monthly/ the
  # long tail. A bare filename is looked for in both; "monthly/<name>" targets
  # one explicitly.
  name="$arg"
  if [[ -z "$name" ]]; then
    # Names are portfolio-YYYY-MM-DD-HHMMSS.db.gpg, so lexical order is
    # chronological and the last one is the newest.
    # Keep the listing's own failure distinguishable from "the listing was
    # empty". Collapsing both into one `|| true` told the operator the push had
    # never run when the real problem was a wrong remote name, expired
    # credentials or no network — the worst possible misdirection in the script
    # you reach for in an emergency.
    if ! listing="$("$RCLONE" lsf "$OFFSITE_REMOTE/daily")"; then
      die "could not list $OFFSITE_REMOTE/daily — check the remote name, credentials and network (rclone's own error is above)"
    fi
    name="$(printf '%s\n' "$listing" | grep '\.db\.gpg$' | sort | tail -1 || true)"
    [[ -n "$name" ]] || die "no .db.gpg objects at $OFFSITE_REMOTE/daily (has the offsite push run? see docs/runbooks/offsite-backup.md)"
    name="daily/$name"
    echo "restore: newest is $name"
  elif [[ "$name" != */* ]]; then
    found=""
    for tier in daily monthly; do
      if "$RCLONE" lsf "$OFFSITE_REMOTE/$tier" 2>/dev/null | grep -qxF "$name"; then
        found="$tier/$name"
        break
      fi
    done
    [[ -n "$found" ]] || die "$name is in neither $OFFSITE_REMOTE/daily nor $OFFSITE_REMOTE/monthly"
    name="$found"
    echo "restore: found $name"
  fi
  enc="$RESTORE_DIR/$(basename "$name")"
  "$RCLONE" copyto "$OFFSITE_REMOTE/$name" "$enc"
fi

out="$RESTORE_DIR/$(basename "${enc%.gpg}")"
gpg --batch --yes --quiet --decrypt --output "$out" "$enc" \
  || die "decryption failed — is the backup private key in this keyring?"

# Prove it is a database, not just bytes that decrypted without complaint.
head -c 16 "$out" | grep -qa "SQLite format 3" || die "$out is not a SQLite database"

integrity="$(sqlite3 "$out" 'PRAGMA integrity_check;')"
[[ "$integrity" == "ok" ]] || die "integrity_check failed: $integrity"

echo "restore: $out"
echo "restore: integrity_check ok"
# Check each count rather than interpolating it: a failing command substitution
# does not fail the enclosing printf under set -e, so a backup predating one of
# these tables used to print a blank column and still end with "this backup is
# restorable".
for t in holdings lots snapshots import_batches wallets wallet_addresses wallet_transfers settings; do
  if ! n="$(sqlite3 "$out" "SELECT COUNT(*) FROM $t;" 2>&1)"; then
    die "could not read table '$t' from $out — it is not the schema this expects ($n)"
  fi
  printf '  %-18s %s\n' "$t" "$n"
done
echo "  latest snapshot $(sqlite3 "$out" 'SELECT date FROM snapshots ORDER BY date DESC LIMIT 1;')"
echo
echo "restore: OK — this backup is restorable."
echo "To run the app against it: copy $out over /opt/portfolio/data/portfolio.db on the Pi"
echo "(stop portfolio.service first, and keep a copy of the file you are replacing)."
