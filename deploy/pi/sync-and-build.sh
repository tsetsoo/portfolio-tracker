#!/usr/bin/env bash
set -euo pipefail
# Run FROM YOUR MAC (not the Pi).
# Syncs the worktree to the Pi, builds there, flips /opt/portfolio/current, restarts.
#
# Usage:
#   ./deploy/pi/sync-and-build.sh
#   PI_HOST=raspberrypi ./deploy/pi/sync-and-build.sh

PI_HOST="${PI_HOST:-raspberrypi}"
PI_USER="${PI_USER:-pi}"
REMOTE="${PI_USER}@${PI_HOST}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
REMOTE_SRC="/opt/portfolio/src"
REMOTE_RELEASE="/opt/portfolio/releases/${SHA}"
NODE_BIN="/opt/portfolio/node/bin"

echo "→ syncing $ROOT → $REMOTE:$REMOTE_SRC (sha $SHA)"
ssh "$REMOTE" "sudo mkdir -p '$REMOTE_SRC' '$REMOTE_RELEASE' && sudo chown -R ${PI_USER}:${PI_USER} /opt/portfolio/src /opt/portfolio/releases /opt/portfolio/data"

rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude data \
  --exclude .superpowers \
  --exclude coverage \
  --exclude 'tsconfig.tsbuildinfo' \
  "$ROOT/" "$REMOTE:$REMOTE_SRC/"

echo "→ building on Pi (this can take a while on Pi 3)"
ssh "$REMOTE" "bash -s" <<EOF
set -euo pipefail
export PATH="${NODE_BIN}:\$PATH"
# Keep the Next build under ~Pi 3 RAM+swap.
export NODE_OPTIONS="--max-old-space-size=768"
cd ${REMOTE_SRC}
# Force native rebuild of better-sqlite3 against Buster's glibc
# (prebuilds often require GLIBC_2.29+).
npm_config_build_from_source=true npm ci --no-fund --no-audit
npm run build
test -f .next/standalone/server.js
rm -rf ${REMOTE_RELEASE}
mkdir -p ${REMOTE_RELEASE}
cp -a .next/standalone/. ${REMOTE_RELEASE}/
mkdir -p ${REMOTE_RELEASE}/.next
cp -a .next/static ${REMOTE_RELEASE}/.next/static
if [[ -d public ]]; then cp -a public ${REMOTE_RELEASE}/public; fi
echo ${SHA} > ${REMOTE_RELEASE}/SHA
# Atomic symlink flip (same trick as todo-update.sh)
tmp=/opt/portfolio/current.tmp
ln -sfn ${REMOTE_RELEASE} \$tmp
if mv --version >/dev/null 2>&1; then
  sudo mv -Tf \$tmp /opt/portfolio/current
else
  sudo mv -hf \$tmp /opt/portfolio/current
fi
sudo systemctl restart portfolio.service
sleep 3
systemctl is-active portfolio.service
curl -fsS -o /dev/null -w "health %{http_code}\\n" http://127.0.0.1:8081/ || true
journalctl -u portfolio.service -n 30 --no-pager || true
EOF

echo "deployed $SHA → http://${PI_HOST}:8081 / http://100.118.255.23:8081"
