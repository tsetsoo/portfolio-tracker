#!/usr/bin/env bash
set -euo pipefail
# Install rclone into /opt/portfolio/bin (armv7).
#
# A static binary, not an apt package: Buster is archived and the host must not
# be dist-upgraded (see install-node.sh for what that costs). Nothing
# system-wide is touched, so removing /opt/portfolio/bin/rclone undoes this.

DEST="${RCLONE_DEST:-/opt/portfolio/bin}"
ARCH="${RCLONE_ARCH:-linux-arm-v7}"

ver="${RCLONE_VERSION:-}"
if [[ -z "$ver" ]]; then
  ver="$(curl -fsSL https://downloads.rclone.org/version.txt | awk '{print $2}')"
fi
[[ "$ver" =~ ^v[0-9]+\.[0-9]+ ]] || { echo "bad rclone version '$ver'" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

url="https://downloads.rclone.org/${ver}/rclone-${ver}-${ARCH}.zip"
echo "install-rclone: fetching $url"
curl -fsSL -o "$work/rclone.zip" "$url"
unzip -q -o "$work/rclone.zip" -d "$work/x"

bin="$(find "$work/x" -name rclone -type f | head -1)"
[[ -n "$bin" ]] || { echo "no rclone binary in the archive" >&2; exit 1; }

install -d -o root -g root -m 0755 "$DEST"
install -o root -g root -m 0755 "$bin" "$DEST/rclone"

# Note: this build prints harmless "no overview data found for <provider>"
# errors on every run; portfolio-backup-offsite.sh filters them so they cannot
# bury a real failure in the journal.
"$DEST/rclone" version 2>/dev/null | head -3
