#!/usr/bin/env bash
set -euo pipefail
# Install rclone into /opt/portfolio/bin (armv7).
#
# A static binary, not an apt package: Buster is archived and the host must not
# be dist-upgraded (see install-node.sh for what that costs). Nothing
# system-wide is touched, so removing /opt/portfolio/bin/rclone undoes this.

DEST="${RCLONE_DEST:-/opt/portfolio/bin}"
ARCH="${RCLONE_ARCH:-linux-arm-v7}"
# Pinned, not "whatever version.txt says today". Two Pis bootstrapped a month
# apart should get the same binary, and portfolio-backup.sh filters a log string
# specific to this build — a silent upgrade could restore the ~18 lines of ERROR
# noise that filter exists to suppress. Bump deliberately.
ver="${RCLONE_VERSION:-v1.75.0}"
[[ "$ver" =~ ^v[0-9]+\.[0-9]+ ]] || { echo "bad rclone version '$ver'" >&2; exit 1; }

command -v unzip >/dev/null || { echo "unzip is required to install rclone (apt-get install unzip)" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

zip="rclone-${ver}-${ARCH}.zip"
url="https://downloads.rclone.org/${ver}/${zip}"
echo "install-rclone: fetching $url"
curl -fsSL -o "$work/$zip" "$url"

# This binary is installed as root and then handed our backups, so check it
# against rclone's published checksums rather than trusting the transfer.
if curl -fsSL -o "$work/SHA256SUMS" "https://downloads.rclone.org/${ver}/SHA256SUMS"; then
  want="$(awk -v f="$zip" '$2 == f || $2 == "*"f {print $1}' "$work/SHA256SUMS" | head -1)"
  if [[ -z "$want" ]]; then
    echo "install-rclone: $zip not listed in SHA256SUMS for $ver" >&2; exit 1
  fi
  got="$(sha256sum "$work/$zip" | awk '{print $1}')"
  if [[ "$want" != "$got" ]]; then
    echo "install-rclone: checksum mismatch for $zip: want $want, got $got" >&2; exit 1
  fi
  echo "install-rclone: sha256 verified"
else
  echo "install-rclone: could not fetch SHA256SUMS for $ver" >&2; exit 1
fi

unzip -q -o "$work/$zip" -d "$work/x"

bin="$(find "$work/x" -name rclone -type f | head -1)"
[[ -n "$bin" ]] || { echo "no rclone binary in the archive" >&2; exit 1; }

install -d -o root -g root -m 0755 "$DEST"
install -o root -g root -m 0755 "$bin" "$DEST/rclone"

# Actually run it, and let a failure stand: a wrong-architecture or truncated
# binary would otherwise install "successfully" and first surface as a failed
# backup at 00:30 the next night.
"$DEST/rclone" version >/dev/null 2>&1 \
  || { echo "install-rclone: $DEST/rclone does not run on this host" >&2; exit 1; }

# Note: this build prints harmless "no overview data found for <provider>"
# errors on every run; portfolio-backup.sh filters them so they cannot bury a
# real failure in the journal.
#
# `|| true` on the cosmetic print only: rclone writes more lines than head
# wants, so head closes the pipe and Go takes SIGPIPE, making this pipeline exit
# 141 under pipefail even though the install is fine.
"$DEST/rclone" version 2>/dev/null | head -3 || true
