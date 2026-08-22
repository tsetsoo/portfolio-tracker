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
#   ./deploy/restore-offsite.sh                        # newest from the remote
#   ./deploy/restore-offsite.sh portfolio-2026-08-22-003020.db.gpg
#   ./deploy/restore-offsite.sh ~/Downloads/some.db.gpg  # a local file
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

  name="$arg"
  if [[ -z "$name" ]]; then
    # Names are portfolio-YYYY-MM-DD-HHMMSS.db.gpg, so lexical order is
    # chronological and the last one is the newest.
    name="$("$RCLONE" lsf "$OFFSITE_REMOTE" | grep '\.db\.gpg$' | sort | tail -1)"
    [[ -n "$name" ]] || die "no .db.gpg objects at $OFFSITE_REMOTE"
    echo "restore: newest is $name"
  fi
  enc="$RESTORE_DIR/$name"
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
for t in holdings lots snapshots import_batches; do
  printf '  %-15s %s\n' "$t" "$(sqlite3 "$out" "SELECT COUNT(*) FROM $t;")"
done
echo "  latest snapshot $(sqlite3 "$out" 'SELECT date FROM snapshots ORDER BY date DESC LIMIT 1;')"
echo
echo "restore: OK — this backup is restorable."
echo "To run the app against it: copy $out over /opt/portfolio/data/portfolio.db on the Pi"
echo "(stop portfolio.service first, and keep a copy of the file you are replacing)."
