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

# Best-effort pull; a cached image must still start when GitHub/DockerHub is down.
docker pull "$IMAGE" >/dev/null 2>&1 || true

# A crashed run can leave the name taken.
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo "starting $IMAGE from $APP_DIR on :$PORT"
exec docker run --rm --name "$CONTAINER" \
  --init \
  --user "$(id -u pi):$(id -g pi)" \
  --publish "${PORT}:${PORT}" \
  --env NODE_ENV=production \
  --env HOSTNAME=0.0.0.0 \
  --env PORT="$PORT" \
  --env DATABASE_PATH=/data/portfolio.db \
  --volume "$APP_DIR:/app" \
  --volume "$ROOT/data:/data" \
  --workdir /app \
  "$IMAGE" node /app/server.js
