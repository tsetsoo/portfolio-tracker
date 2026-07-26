#!/usr/bin/env bash
set -euo pipefail
# Run on the Pi as root (or via sudo).
# Usage: sudo ./bootstrap.sh
#
# Layout (mirrors /opt/todo from the todo-app Pi deploy):
#   /opt/portfolio/
#     current -> releases/<sha>/     # Next standalone server
#     releases/<sha>/
#     data/portfolio.db              # persistent SQLite (never overwritten)
#     node/                          # Node.js runtime (armv7l)
#     src/                           # optional build checkout

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

install -d -o root -g root -m 0755 /opt/portfolio /opt/portfolio/releases /opt/portfolio/node
install -d -o pi -g pi -m 0755 /opt/portfolio/data /opt/portfolio/src
install -m 0644 "$REPO_DIR/portfolio.service" /etc/systemd/system/portfolio.service

systemctl daemon-reload
systemctl enable portfolio.service

if [[ -x /opt/portfolio/node/bin/node && -f /opt/portfolio/current/server.js ]]; then
  systemctl restart portfolio.service
  systemctl status portfolio.service --no-pager || true
else
  echo "bootstrap: units installed. Finish with deploy/pi/install-node.sh then deploy/pi/sync-and-build.sh"
fi
