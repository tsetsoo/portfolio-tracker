#!/usr/bin/env bash
set -euo pipefail
# Encrypt the verified local backups and push them off the device.
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
# How many encrypted copies to keep at the far end, per tier.
OFFSITE_KEEP="${OFFSITE_KEEP:-30}"
OFFSITE_KEEP_MONTHLY="${OFFSITE_KEEP_MONTHLY:-12}"
# Warn if the newest local backup is older than this. Catches "the local backup
# has been broken for days" from this side too, rather than faithfully pushing
# the same stale file every night and reporting success.
MAX_AGE_HOURS="${MAX_AGE_HOURS:-25}"
# How long to wait for a local backup that is currently running. Must exceed
# portfolio-backup.sh's own worst case, or this gives up on precisely the night
# the retries were needed: COPY_ATTEMPTS(3) x CONTAINER_WAIT(120) plus two
# RETRY_DELAY(30) gaps is already ~420s, so 300 was too short.
BACKUP_WAIT="${BACKUP_WAIT:-900}"
BACKUP_UNIT="${BACKUP_UNIT:-portfolio-backup.service}"

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
# Filtered synchronously via a temp file rather than `2> >(grep …)`: bash does
# not wait for process-substitution children, and every failure path here exits
# immediately afterwards. With Type=oneshot systemd tears down the cgroup on
# exit, so the grep could be killed before flushing — losing exactly the rclone
# error this wrapper exists to keep readable.
rc() {
  local err status=0
  err="$(mktemp)"
  "$RCLONE" --config "$RCLONE_CONFIG_FILE" "$@" 2>"$err" || status=$?
  grep -v 'internal error: no overview data found for' "$err" >&2 || true
  rm -f "$err"
  return "$status"
}

# Temp paths in globals so one trap clears them on every exit path, signals
# included: the encrypted file is derived from the plaintext database and should
# not be left in /tmp. The INT/TERM handler exits rather than returning, because
# a bash trap otherwise resumes where it was interrupted.
ENC_TMP=""
READBACK_TMP=""
cleanup_tmp() {
  [[ -n "$ENC_TMP" ]] && rm -f "$ENC_TMP"
  [[ -n "$READBACK_TMP" ]] && rm -f "$READBACK_TMP"
  return 0
}
trap cleanup_tmp EXIT
trap 'cleanup_tmp; exit 143' INT TERM

# --- refuse to run if the Pi can decrypt its own backups --------------------
# If the secret key ever lands here the whole design is void, and it would fail
# silently and invisibly. Fail loudly instead.
if gpg --list-secret-keys "$GPG_RECIPIENT" >/dev/null 2>&1; then
  die "the SECRET key for $GPG_RECIPIENT is present on this host. The Pi must hold only the public key — remove it with 'gpg --delete-secret-keys $GPG_RECIPIENT'"
fi
gpg --list-keys "$GPG_RECIPIENT" >/dev/null 2>&1 \
  || die "public key $GPG_RECIPIENT not in pi's keyring — import it first"

# --- do not race the local backup -------------------------------------------
# After downtime both timers fire their missed runs at once (Persistent=true),
# and After= only orders units started in the same transaction — so this can
# start *before* the backup it is meant to follow, find a days-old copy, and
# fail the age guard below for no real reason. If the backup is running, wait.
waited=0
while :; do
  state="$(systemctl show -p ActiveState --value "$BACKUP_UNIT" 2>/dev/null || echo unknown)"
  case "$state" in
    activating|active|reloading) ;;
    *) break ;;
  esac
  if (( waited >= BACKUP_WAIT )); then
    die "$BACKUP_UNIT has been $state for ${BACKUP_WAIT}s — not pushing while it may still be writing"
  fi
  if (( waited == 0 )); then
    log "$BACKUP_UNIT is $state — waiting for it to finish"
  fi
  sleep 5
  waited=$(( waited + 5 ))
done
if (( waited > 0 )); then
  log "local backup finished after ${waited}s"
fi

# --- pick the newest verified local backup ----------------------------------
newest="$(ls -1t "$BACKUP_DIR"/daily/*.db 2>/dev/null | head -1 || true)"
[[ -n "$newest" ]] || die "no local backup in $BACKUP_DIR/daily to push — has portfolio-backup.service run?"

age_s=$(( $(date +%s) - $(stat -c %Y "$newest") ))
if (( age_s > MAX_AGE_HOURS * 3600 )); then
  die "newest local backup $(basename "$newest") is $(( age_s / 3600 ))h old (> ${MAX_AGE_HOURS}h) — the local backup is broken; fix that before trusting the offsite copy"
fi

# --- encrypt one file, push it, and prove it arrived ------------------------
# Factored out because the monthlies need exactly the same treatment as the
# daily; see the monthly section for why they are pushed at all.
push_one() {
  local src="$1" remote_dir="$2" label="$3"
  local base remote_name plain_size enc_size local_hash
  local size_json remote_count remote_size remote_hash

  base="$(basename "$src")"
  remote_name="$base.gpg"

  ENC_TMP="$(mktemp -t "${base}.XXXXXX.gpg")"
  chmod 0600 "$ENC_TMP"

  # --trust-model always: this is our own backup key, deliberately not signed
  # into a web of trust. It is pinned by fingerprint in the config.
  gpg --batch --yes --quiet --trust-model always \
      --recipient "$GPG_RECIPIENT" \
      --output "$ENC_TMP" --encrypt "$src" \
    || die "gpg encryption failed for $base"

  [[ -s "$ENC_TMP" ]] || die "encrypted output is empty for $base"
  # Cheapest possible proof we are about to upload ciphertext and not the
  # database itself. A SQLite file starts with the magic "SQLite format 3\0".
  if head -c 16 "$ENC_TMP" | grep -qa "SQLite format 3"; then
    die "refusing to upload: encrypted output still looks like a plain database"
  fi

  plain_size="$(stat -c %s "$src")"
  enc_size="$(stat -c %s "$ENC_TMP")"
  local_hash="$(sha256sum "$ENC_TMP" | awk '{print $1}')"

  rc copyto "$ENC_TMP" "$remote_dir/$remote_name" \
    || die "upload to $remote_dir/$remote_name failed"

  # Prove it arrived. The failure this guards is a push that reports success
  # while writing nowhere, so trust the far end's own accounting, not rclone's
  # exit code.
  #
  # `rclone size --json` rather than a regex over lsjson: scraping
  # "Size":([0-9]*) matched the empty string on anything the pattern did not
  # anticipate — a space after the colon, or a backend reporting -1 for unknown
  # size — producing an empty value and a spurious "not listed" death, a false
  # alarm about the very failure this check exists to detect.
  #
  # `|| true` matters: when the object is genuinely missing rclone exits
  # non-zero, and under pipefail that would kill the script before the die
  # below could say why. A guard has to survive the failure it is guarding.
  size_json="$(rc size --json "$remote_dir/$remote_name" || true)"
  remote_count="$(printf '%s' "$size_json" | grep -o '"count":[[:space:]]*[0-9]\+' | grep -o '[0-9]\+' || true)"
  remote_size="$(printf '%s' "$size_json" | grep -o '"bytes":[[:space:]]*-\?[0-9]\+' | grep -o '\-\?[0-9]\+' || true)"
  [[ "$remote_count" == "1" ]] \
    || die "$remote_name is not at $remote_dir after a reported successful upload (count=${remote_count:-none})"
  [[ -n "$remote_size" && "$remote_size" != "-1" ]] \
    || die "$remote_dir did not report a usable size for $remote_name (got '${remote_size:-none}') — cannot confirm the upload"
  [[ "$remote_size" == "$enc_size" ]] \
    || die "size mismatch at the far end for $remote_name: local $enc_size, remote $remote_size"

  # Read the bytes back and hash them. Size alone would not catch corruption in
  # transit, and this may be the only copy that survives the SD card.
  READBACK_TMP="$(mktemp)"
  # No 2>/dev/null: rc already strips the known cosmetic lines, and silencing
  # its stderr would discard the actual reason a read-back failed — expired
  # auth, a vanished object, a network error — leaving only the generic die.
  rc cat "$remote_dir/$remote_name" > "$READBACK_TMP" \
    || die "could not read $remote_name back from $remote_dir"
  remote_hash="$(sha256sum "$READBACK_TMP" | awk '{print $1}')"
  rm -f "$READBACK_TMP"; READBACK_TMP=""
  [[ "$remote_hash" == "$local_hash" ]] \
    || die "checksum mismatch after read-back of $remote_name: local $local_hash, remote $remote_hash"

  rm -f "$ENC_TMP"; ENC_TMP=""
  log "pushed $label $remote_name ($plain_size -> $enc_size bytes, sha256 ${local_hash:0:16}…)"
}

# --- prune one tier at the far end -----------------------------------------
prune_remote() {
  local remote_dir="$1" keep="$2" label="$3"
  local listing kept drop old
  local -a files

  # Distinguish "the remote lists nothing" from "the listing failed". A blanket
  # `|| true` here would turn a lost list permission into kept=0, skip the
  # prune, and report success — remote retention would stop forever while every
  # run stayed green, the very thing the die below exists to prevent.
  listing="$(rc lsf "$remote_dir")" \
    || die "could not list $remote_dir — cannot enforce remote retention"
  mapfile -t files < <(printf '%s\n' "$listing" | grep '\.db\.gpg$' | sort || true)
  kept=${#files[@]}
  (( kept > 0 )) \
    || die "listed $remote_dir but found no .db.gpg objects immediately after uploading to it"

  if (( kept > keep )); then
    drop=$(( kept - keep ))
    # Names are portfolio-YYYY-MM-DD-HHMMSS.db.gpg, so lexical order is
    # chronological and the oldest are at the front.
    for old in "${files[@]:0:$drop}"; do
      # Not `&& log`: bash exempts the left side of && from set -e, so a delete
      # failing on provider permissions would be silently ignored.
      if ! rc deletefile "$remote_dir/$old"; then
        die "failed to prune $remote_dir/$old — retention is not being enforced at the far end"
      fi
      log "pruned $label $old"
      kept=$(( kept - 1 ))
    done
  fi
  log "$label: $kept kept"
}

# rclone mkdir is idempotent, and doing it up front means the first-ever run
# does not have to treat "directory missing" as a listing failure.
rc mkdir "$OFFSITE_REMOTE/daily" || die "could not create $OFFSITE_REMOTE/daily"
rc mkdir "$OFFSITE_REMOTE/monthly" || die "could not create $OFFSITE_REMOTE/monthly"

# --- the daily -------------------------------------------------------------
# Age is logged because MAX_AGE_HOURS deliberately tolerates one missed local
# backup: without it, re-pushing yesterday's file under a name that already
# exists is indistinguishable from a fresh push — the object is overwritten, the
# remote count does not grow, and the run still ends in "ok".
log "newest local backup $(basename "$newest") is $(( age_s / 3600 ))h old"
push_one "$newest" "$OFFSITE_REMOTE/daily" daily
prune_remote "$OFFSITE_REMOTE/daily" "$OFFSITE_KEEP" daily

# --- the monthlies ---------------------------------------------------------
# The justification for keeping 12 monthlies is that snapshot history cannot be
# backfilled. Keeping them only as hardlinks on the SD card whose failure this
# feature exists to survive would defeat that entirely: damage noticed more
# than OFFSITE_KEEP days later would be unrecoverable off-device while the
# on-device monthlies that covered it died with the card. Only the ones not
# already at the far end are uploaded, so this costs one listing a night and an
# actual upload about once a month.
monthly_listing="$(rc lsf "$OFFSITE_REMOTE/monthly")" \
  || die "could not list $OFFSITE_REMOTE/monthly"
shopt -s nullglob
local_monthlies=( "$BACKUP_DIR"/monthly/*.db )
shopt -u nullglob
pushed_monthly=0
for m in "${local_monthlies[@]}"; do
  if printf '%s\n' "$monthly_listing" | grep -qxF "$(basename "$m").gpg"; then
    continue
  fi
  push_one "$m" "$OFFSITE_REMOTE/monthly" monthly
  pushed_monthly=$(( pushed_monthly + 1 ))
done
if (( pushed_monthly == 0 )); then
  log "monthlies already off-device (${#local_monthlies[@]} local)"
fi
prune_remote "$OFFSITE_REMOTE/monthly" "$OFFSITE_KEEP_MONTHLY" monthly

log "ok — $OFFSITE_REMOTE"
