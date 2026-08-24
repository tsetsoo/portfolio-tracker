#!/usr/bin/env bash
set -euo pipefail
# Launch the portfolio app for portfolio.service.
#
# Releases built by deploy/pi/Dockerfile carry a NODE_IMAGE file naming the exact
# image they were compiled in; better-sqlite3 is native, so it must run under
# that same image. Releases predating containerisation have no NODE_IMAGE and are
# run with the host's Node 18 instead — which is what makes an automatic
# rollback across the transition work (see portfolio-update.sh).
#
# Runs in the foreground so systemd (Type=simple) supervises it directly.

ROOT="${PORTFOLIO_ROOT:-/opt/portfolio}"
CURRENT="$ROOT/current"
PORT="${PORT:-8081}"
CONTAINER="${CONTAINER_NAME:-portfolio-app}"

if [[ ! -f "$CURRENT/server.js" ]]; then
  echo "no server.js under $CURRENT" >&2
  exit 1
fi

if [[ ! -f "$CURRENT/NODE_IMAGE" ]]; then
  echo "no NODE_IMAGE in release — running with host node (legacy release)"
  exec "$ROOT/node/bin/node" "$CURRENT/server.js"
fi

IMAGE="$(tr -d '[:space:]' < "$CURRENT/NODE_IMAGE")"
if [[ -z "$IMAGE" ]]; then
  echo "NODE_IMAGE is empty" >&2
  exit 1
fi

# Resolve the symlink: bind-mounting `current` directly would pin the container
# to whatever it pointed at when the mount was set up.
APP_DIR="$(readlink -f "$CURRENT")"

# Only reach for the network when the image is genuinely absent. Pulling an
# already-cached image costs a pointless round-trip on every restart and burns
# Docker Hub rate limit; portfolio-update.sh pre-pulls on deploy anyway.
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "image $IMAGE not present locally; pulling"
  docker pull "$IMAGE" >/dev/null 2>&1 || true
fi

# A crashed run can leave the name taken.
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

# Containers default to UTC. The app derives "today" for net-worth snapshots
# from its own clock, so a UTC container records the previous day for anything
# happening between local midnight and the UTC offset — which silently made the
# 00:12 snapshot timer write yesterday's date every night, and it can never be
# corrected because snapshot writes are first-write-wins per date.
TZ_NAME="$(cat /etc/timezone 2>/dev/null || true)"
: "${TZ_NAME:=Etc/UTC}"

# Secrets live outside releases/ so a deploy never overwrites them.
ENV_FILE_ARGS=()
if [[ -f "$ROOT/portfolio.env" ]]; then
  ENV_FILE_ARGS=(--env-file "$ROOT/portfolio.env")
fi

echo "starting $IMAGE from $APP_DIR on :$PORT (TZ $TZ_NAME)"
exec docker run --rm --name "$CONTAINER" \
  --init \
  --user "$(id -u pi):$(id -g pi)" \
  --env TZ="$TZ_NAME" \
  --publish "${PORT}:${PORT}" \
  --env NODE_ENV=production \
  --env HOSTNAME=0.0.0.0 \
  --env PORT="$PORT" \
  --env DATABASE_PATH=/data/portfolio.db \
  "${ENV_FILE_ARGS[@]}" \
  --volume "$APP_DIR:/app" \
  --volume "$ROOT/data:/data" \
  --workdir /app \
  "$IMAGE" node /app/server.js
