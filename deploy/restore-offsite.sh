#!/usr/bin/env bash
set -euo pipefail
# Restore drill: fetch an encrypted backup, decrypt it, prove it is usable.
#
# Runs wherever the backup PRIVATE key lives — your Mac, not the Pi. The Pi
# deliberately cannot do this.
#
# A backup nobody has ever restored is a hypothesis. Run it occasionally.
#
#   ./deploy/restore-offsite.sh                       # newest
#   ./deploy/restore-offsite.sh portfolio-2026-08-24-003137.db.gpg
#   ./deploy/restore-offsite.sh ~/Downloads/some.db.gpg
#
# Env: REMOTE (rclone remote:path), RESTORE_DIR (default ./data/restore)

# 0077: this writes the decrypted database in the clear. The Pi keeps the same
# bytes at 0600 inside a 0700 directory; leaving the restored copy world-readable
# on a shared machine would undo that.
umask 077

REMOTE="${REMOTE:-}"
# Anchored to the repo, not the current directory. A relative default wrote to
# <cwd>/data/restore, and .gitignore's "data/restore/" is anchored to the repo
# root — so running the drill from a subdirectory dropped a plaintext database
# somewhere git would happily commit.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESTORE_DIR="${RESTORE_DIR:-$REPO_ROOT/data/restore}"
RCLONE="${RCLONE:-rclone}"

die() { echo "restore: $*" >&2; exit 1; }
command -v gpg >/dev/null || die "gpg not found (brew install gnupg)"
command -v python3 >/dev/null || die "python3 not found"

mkdir -p "$RESTORE_DIR"
arg="${1:-}"

if [[ -n "$arg" && -f "$arg" ]]; then
  enc="$arg"
else
  command -v "$RCLONE" >/dev/null || die "rclone not found (brew install rclone), or pass a local .gpg path"
  [[ -n "$REMOTE" ]] || die "set REMOTE to the rclone remote:path holding the backups"
  name="$arg"
  if [[ -z "$name" ]]; then
    # Keep "the listing failed" distinguishable from "the listing was empty":
    # telling you the backups do not exist when the real problem is credentials
    # is the worst possible misdirection in an emergency.
    listing="$("$RCLONE" lsf "$REMOTE")" \
      || die "could not list $REMOTE — check the remote name, credentials and network"
    name="$(printf '%s\n' "$listing" | grep '\.db\.gpg$' | sort | tail -1 || true)"
    [[ -n "$name" ]] || die "no .db.gpg objects at $REMOTE — has the backup run?"
    echo "restore: newest is $name"
  fi
  enc="$RESTORE_DIR/$name"
  "$RCLONE" copyto "$REMOTE/$name" "$enc"
fi

out="$RESTORE_DIR/$(basename "${enc%.gpg}")"
gpg --batch --yes --quiet --decrypt --output "$out" "$enc" \
  || die "decryption failed — is the backup private key in this keyring?"

python3 - "$out" <<'PY' || die "$out is not a usable database"
import sqlite3, sys
p = sys.argv[1]
c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
ok = c.execute("PRAGMA integrity_check").fetchone()[0]
if ok != "ok":
    raise SystemExit("integrity_check: %s" % ok)
for t in ("holdings", "lots", "snapshots", "import_batches",
          "wallets", "wallet_addresses", "wallet_transfers", "settings"):
    print("  %-18s %d" % (t, c.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]))
print("  newest snapshot    %s" % c.execute("SELECT MAX(date) FROM snapshots").fetchone()[0])
c.close()
PY

echo "restore: OK — $out is restorable."
echo "To put it back: stop portfolio, copy it over /opt/portfolio/data/portfolio.db"
echo "(keep the file you replace), then start portfolio. See the runbook."
