#!/usr/bin/env bash
set -euo pipefail

PORTFOLIO_ROOT="${PORTFOLIO_ROOT:-/opt/portfolio}"
PORTFOLIO_RELEASE_BASE="${PORTFOLIO_RELEASE_BASE:-https://github.com/tsetsoo/portfolio-tracker/releases/download/pi-latest}"
PORTFOLIO_HEALTH_URL="${PORTFOLIO_HEALTH_URL:-http://127.0.0.1:8081/}"
PORTFOLIO_SYSTEMCTL="${PORTFOLIO_SYSTEMCTL:-systemctl}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"

mkdir -p "$PORTFOLIO_ROOT/releases" "$PORTFOLIO_ROOT/data"

# Bust GitHub release-asset CDN cache; otherwise SHA can lag the new tarball.
CACHE_BUST="$(date +%s)"

remote_sha="$(curl -fsSL "$PORTFOLIO_RELEASE_BASE/SHA?ts=$CACHE_BUST" | tr -d '[:space:]')"
if [[ -z "$remote_sha" || ! "$remote_sha" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "invalid remote SHA: '$remote_sha'" >&2
  exit 1
fi

local_sha=""
if [[ -f "$PORTFOLIO_ROOT/current/SHA" ]]; then
  local_sha="$(tr -d '[:space:]' < "$PORTFOLIO_ROOT/current/SHA")"
fi

if [[ "$remote_sha" == "$local_sha" ]]; then
  echo "already at $remote_sha"
  exit 0
fi

prev=""
if [[ -L "$PORTFOLIO_ROOT/current" ]]; then
  prev="$(readlink -f "$PORTFOLIO_ROOT/current" || true)"
fi

# Atomically point $PORTFOLIO_ROOT/current at $1 (symlink swap via rename).
flip_current() {
  local tmp="$PORTFOLIO_ROOT/current.tmp"
  ln -sfn "$1" "$tmp"
  if mv --version >/dev/null 2>&1; then
    mv -Tf "$tmp" "$PORTFOLIO_ROOT/current"
  else
    mv -hf "$tmp" "$PORTFOLIO_ROOT/current"
  fi
}

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

curl -fsSL "$PORTFOLIO_RELEASE_BASE/portfolio-pi.tar.gz?ts=$CACHE_BUST" -o "$workdir/portfolio-pi.tar.gz"
dest="$PORTFOLIO_ROOT/releases/$remote_sha"
rm -rf "$dest"
mkdir -p "$dest"
tar --no-same-owner -C "$dest" -xzf "$workdir/portfolio-pi.tar.gz"

if [[ ! -f "$dest/server.js" || ! -f "$dest/SHA" ]]; then
  echo "release payload incomplete (need server.js + SHA)" >&2
  rm -rf "$dest"
  exit 1
fi

extracted_sha="$(tr -d '[:space:]' < "$dest/SHA")"
if [[ "$extracted_sha" != "$remote_sha" ]]; then
  echo "payload SHA mismatch: extracted '$extracted_sha' != remote '$remote_sha'" >&2
  rm -rf "$dest"
  exit 1
fi

# Docker/buildx export can leave dirs as 0700 root — systemd User=pi needs
# traverse+read to chdir into WorkingDirectory and load the standalone tree.
chmod -R a+rX "$dest"
chown -R pi:pi "$dest"

# Pull the release's runtime image before the flip, so the restart is not
# waiting on a multi-minute download while the old release is already gone.
# Non-fatal: run-container.sh retries, and a cached image still starts offline.
if [[ -f "$dest/NODE_IMAGE" ]]; then
  node_image="$(tr -d '[:space:]' < "$dest/NODE_IMAGE")"
  if [[ -n "$node_image" ]]; then
    echo "pre-pulling $node_image"
    docker pull "$node_image" >/dev/null 2>&1 || echo "pre-pull failed; will retry at start"
  fi
fi

flip_current "$dest"

restart_failed=0
"$PORTFOLIO_SYSTEMCTL" restart portfolio || restart_failed=1

ok=0
if [[ "$restart_failed" -eq 0 ]]; then
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if curl -fsS "$PORTFOLIO_HEALTH_URL" >/dev/null; then
      ok=1
      break
    fi
    sleep 1
  done
fi

if [[ "$restart_failed" -eq 1 || "$ok" -ne 1 ]]; then
  echo "health check failed; rolling back" >&2
  if [[ -n "$prev" && -d "$prev" ]]; then
    "$PORTFOLIO_SYSTEMCTL" reset-failed portfolio || true
    flip_current "$prev"
    "$PORTFOLIO_SYSTEMCTL" restart portfolio || true
  fi
  exit 1
fi

# prune old releases (keep newest KEEP_RELEASES by mtime)
# shellcheck disable=SC2012
ls -1dt "$PORTFOLIO_ROOT/releases"/* 2>/dev/null | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
  [[ "$(readlink -f "$PORTFOLIO_ROOT/current")" == "$(readlink -f "$old")" ]] && continue
  rm -rf "$old"
done

echo "deployed $remote_sha"
