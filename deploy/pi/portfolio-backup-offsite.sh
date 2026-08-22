#!/usr/bin/env bash
set -euo pipefail
# Encrypt the newest verified local backup and push it off the device.
#
# This is financial data leaving the house, so it is encrypted before it moves,
# with an asymmetric key: the Pi holds only the *public* half and physically
# cannot read its own backups. That is deliberate — it means a compromise of the
# Pi, or of the storage provider, leaks nothing, and it satisfies the rule that
# the decryption key must not live only on the device being backed up.
#
# The corollary is that losing the private key loses the backups. See
# docs/runbooks/offsite-backup.md for where it is meant to live.
#
# gpg rather than age because gpg 2.2.12 is already on the host and the host is
# a Raspbian Buster box that should not be dist-upgraded for a new dependency.
# rclone rather than a hand-rolled S3 signer because the storage provider is a
# config line rather than a rewrite.

CONFIG="${PORTFOLIO_OFFSITE_CONFIG:-/etc/portfolio-backup-offsite.env}"
# shellcheck source=/dev/null
[[ -f "$CONFIG" ]] && source "$CONFIG"

PORTFOLIO_ROOT="${PORTFOLIO_ROOT:-/opt/portfolio}"
DATA_DIR="${PORTFOLIO_DATA_DIR:-$PORTFOLIO_ROOT/data}"
BACKUP_DIR="${PORTFOLIO_BACKUP_DIR:-$DATA_DIR/backups}"
RCLONE="${RCLONE:-$PORTFOLIO_ROOT/bin/rclone}"
RCLONE_CONFIG_FILE="${RCLONE_CONFIG_FILE:-$PORTFOLIO_ROOT/rclone.conf}"
# rclone "remote:path", e.g. b2:tsetsoo-portfolio-backups/pi
OFFSITE_REMOTE="${OFFSITE_REMOTE:-}"
# Fingerprint or key id of the backup *public* key.
GPG_RECIPIENT="${GPG_RECIPIENT:-}"
# How many encrypted copies to keep at the far end.
OFFSITE_KEEP="${OFFSITE_KEEP:-30}"
# Warn if the newest local backup is older than this. Catches "the local backup
# has been broken for days" from this side too, rather than faithfully pushing
# the same stale file every night and reporting success.
MAX_AGE_HOURS="${MAX_AGE_HOURS:-25}"

log() { echo "offsite: $*"; }
die() { echo "offsite: $*" >&2; exit 1; }

if [[ -z "$OFFSITE_REMOTE" || -z "$GPG_RECIPIENT" ]]; then
  die "not configured yet — set OFFSITE_REMOTE and GPG_RECIPIENT in $CONFIG. See docs/runbooks/offsite-backup.md"
fi
[[ -x "$RCLONE" ]] || die "rclone not found at $RCLONE"
[[ -f "$RCLONE_CONFIG_FILE" ]] || die "no rclone config at $RCLONE_CONFIG_FILE — run the setup in docs/runbooks/offsite-backup.md"
# -r as well as -f: a root-owned config is the likely outcome of creating it
# with sudo, and this unit runs as pi. Say so, rather than letting rclone fail
# later with an opaque permission error.
[[ -r "$RCLONE_CONFIG_FILE" ]] || die "$RCLONE_CONFIG_FILE is not readable by $(id -un) — it should be owned by pi with mode 0600"

export RCLONE_CONFIG="$RCLONE_CONFIG_FILE"

# rclone v1.75.0 on armv7 prints ~18 "internal error: no overview data found
# for <provider>" lines at ERROR level on every single invocation. They are
# cosmetic — a missing docs table in this build, unrelated to the transfer — but
# left alone they would bury a real error in the nightly journal, which is
# exactly what this unit exists to make visible. Drop those lines only; keep
# every other stderr line and rclone's exit status.
rc() {
  "$RCLONE" --config "$RCLONE_CONFIG_FILE" "$@" \
    2> >(grep -v 'internal error: no overview data found for' >&2)
}

# --- refuse to run if the Pi can decrypt its own backups --------------------
# If the secret key ever lands here the whole design is void, and it would fail
# silently and invisibly. Fail loudly instead.
if gpg --list-secret-keys "$GPG_RECIPIENT" >/dev/null 2>&1; then
  die "the SECRET key for $GPG_RECIPIENT is present on this host. The Pi must hold only the public key — remove it with 'gpg --delete-secret-keys $GPG_RECIPIENT'"
fi
gpg --list-keys "$GPG_RECIPIENT" >/dev/null 2>&1 \
  || die "public key $GPG_RECIPIENT not in pi's keyring — import it first"

# --- pick the newest verified local backup ----------------------------------
newest="$(ls -1t "$BACKUP_DIR"/daily/*.db 2>/dev/null | head -1 || true)"
[[ -n "$newest" ]] || die "no local backup in $BACKUP_DIR/daily to push — has portfolio-backup.service run?"

age_s=$(( $(date +%s) - $(stat -c %Y "$newest") ))
if (( age_s > MAX_AGE_HOURS * 3600 )); then
  die "newest local backup $(basename "$newest") is $(( age_s / 3600 ))h old (> ${MAX_AGE_HOURS}h) — the local backup is broken; fix that before trusting the offsite copy"
fi

base="$(basename "$newest")"
enc="$(mktemp -t "${base}.XXXXXX.gpg")"
trap 'rm -f "$enc"' EXIT

# --- encrypt ----------------------------------------------------------------
# --trust-model always: this is our own backup key, deliberately not signed into
# a web of trust. The key is pinned by fingerprint in the config.
gpg --batch --yes --quiet --trust-model always \
    --recipient "$GPG_RECIPIENT" \
    --output "$enc" --encrypt "$newest" \
  || die "gpg encryption failed for $base"

[[ -s "$enc" ]] || die "encrypted output is empty for $base"
# Cheapest possible proof we are about to upload ciphertext and not the database
# itself. A SQLite file starts with the 16-byte magic "SQLite format 3\0".
if head -c 16 "$enc" | grep -qa "SQLite format 3"; then
  die "refusing to upload: encrypted output still looks like a plain database"
fi

plain_size="$(stat -c %s "$newest")"
enc_size="$(stat -c %s "$enc")"
local_hash="$(sha256sum "$enc" | awk '{print $1}')"
log "encrypted $base ($plain_size -> $enc_size bytes) for $GPG_RECIPIENT"

# --- push -------------------------------------------------------------------
remote_name="$base.gpg"
rc copyto "$enc" "$OFFSITE_REMOTE/$remote_name" \
  || die "upload to $OFFSITE_REMOTE/$remote_name failed"

# --- prove it actually arrived ----------------------------------------------
# The failure this guards is a push that reports success while writing nowhere,
# so trust the far end's own listing, not rclone's exit code.
# `|| true` matters: when the object is genuinely missing rclone exits non-zero,
# and under `set -o pipefail` that would kill the script here — before the die
# below could say why. The guard has to survive the failure it is guarding.
remote_size="$(rc lsjson "$OFFSITE_REMOTE/$remote_name" \
  | sed -n 's/.*"Size":\([0-9]*\).*/\1/p' | head -1 || true)"
[[ -n "$remote_size" ]] || die "$remote_name is not listed at $OFFSITE_REMOTE after a reported successful upload"
[[ "$remote_size" == "$enc_size" ]] \
  || die "size mismatch at the far end: local $enc_size, remote $remote_size"

# Read the bytes back and hash them. Size alone would not catch corruption in
# transit, and this is the only copy that survives the SD card.
readback="$(mktemp)"
if rc cat "$OFFSITE_REMOTE/$remote_name" > "$readback" 2>/dev/null; then
  remote_hash="$(sha256sum "$readback" | awk '{print $1}')"
  rm -f "$readback"
  [[ "$remote_hash" == "$local_hash" ]] \
    || die "checksum mismatch after read-back: local $local_hash, remote $remote_hash"
  log "verified read-back sha256 ${local_hash:0:16}…"
else
  rm -f "$readback"
  die "could not read $remote_name back from $OFFSITE_REMOTE"
fi

# --- prune the far end ------------------------------------------------------
mapfile -t remote_files < <(rc lsf "$OFFSITE_REMOTE" | grep '\.db\.gpg$' | sort || true)
kept=${#remote_files[@]}
if (( kept > OFFSITE_KEEP )); then
  drop=$(( kept - OFFSITE_KEEP ))
  # Names are portfolio-YYYY-MM-DD-HHMMSS.db.gpg, so lexical sort is chronological.
  for old in "${remote_files[@]:0:$drop}"; do
    # Not `&& log`: bash exempts the left side of && from set -e, so a delete
    # that fails on provider permissions would be silently ignored and remote
    # retention would quietly stop working while every run still looked green.
    if ! rc deletefile "$OFFSITE_REMOTE/$old"; then
      die "failed to prune remote $old — retention is not being enforced at the far end"
    fi
    log "pruned remote $old"
    kept=$(( kept - 1 ))
  done
fi

log "ok — $remote_name at $OFFSITE_REMOTE ($kept kept)"
