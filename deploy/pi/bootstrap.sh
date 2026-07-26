#!/usr/bin/env bash
set -euo pipefail
# Run on the Pi as root (or via sudo).
# Usage: sudo ./bootstrap.sh
#
# Layout (mirrors /opt/todo):
#   /opt/portfolio/
#     current -> releases/<sha>/     # Next standalone from GitHub Release
#     releases/<sha>/
#     data/portfolio.db              # persistent SQLite (never overwritten)
#     node/                          # Node 18 runtime (armv7l) — install-node.sh
#     portfolio-update.sh            # puller

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

install -d -o root -g root -m 0755 /opt/portfolio /opt/portfolio/releases
install -d -o pi -g pi -m 0755 /opt/portfolio/data
install -o root -g root -m 0755 "$REPO_DIR/portfolio-update.sh" /opt/portfolio/portfolio-update.sh
install -m 0644 "$REPO_DIR/portfolio.service" /etc/systemd/system/portfolio.service
install -m 0644 "$REPO_DIR/portfolio-update.service" /etc/systemd/system/portfolio-update.service
install -m 0644 "$REPO_DIR/portfolio-update.timer" /etc/systemd/system/portfolio-update.timer

systemctl daemon-reload

if [[ ! -x /opt/portfolio/node/bin/node ]]; then
  echo "bootstrap: installing Node 18 into /opt/portfolio/node"
  "$REPO_DIR/install-node.sh"
fi

# First pull (may fail if pi-latest not published yet — OK)
/opt/portfolio/portfolio-update.sh || echo "first pull deferred until pi-latest exists"
systemctl enable --now portfolio.service || true
systemctl enable --now portfolio-update.timer
systemctl status portfolio.service --no-pager || true
systemctl list-timers portfolio-update.timer --no-pager
