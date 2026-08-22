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
#                                    # only used for pre-container releases
#     run-container.sh               # launcher (reads release's NODE_IMAGE)
#     portfolio-update.sh            # puller

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

install -d -o root -g root -m 0755 /opt/portfolio /opt/portfolio/releases
install -d -o pi -g pi -m 0755 /opt/portfolio/data
install -o root -g root -m 0755 "$REPO_DIR/portfolio-update.sh" /opt/portfolio/portfolio-update.sh
install -o root -g root -m 0755 "$REPO_DIR/run-container.sh" /opt/portfolio/run-container.sh
install -o root -g root -m 0755 "$REPO_DIR/portfolio-backup.sh" /opt/portfolio/portfolio-backup.sh
install -o root -g root -m 0755 "$REPO_DIR/portfolio-backup-offsite.sh" /opt/portfolio/portfolio-backup-offsite.sh
install -m 0644 "$REPO_DIR/portfolio.service" /etc/systemd/system/portfolio.service
install -m 0644 "$REPO_DIR/portfolio-update.service" /etc/systemd/system/portfolio-update.service
install -m 0644 "$REPO_DIR/portfolio-update.timer" /etc/systemd/system/portfolio-update.timer
install -m 0644 "$REPO_DIR/portfolio-snapshot.service" /etc/systemd/system/portfolio-snapshot.service
install -m 0644 "$REPO_DIR/portfolio-snapshot.timer" /etc/systemd/system/portfolio-snapshot.timer
install -m 0644 "$REPO_DIR/portfolio-backup.service" /etc/systemd/system/portfolio-backup.service
install -m 0644 "$REPO_DIR/portfolio-backup.timer" /etc/systemd/system/portfolio-backup.timer
install -m 0644 "$REPO_DIR/portfolio-backup-offsite.service" /etc/systemd/system/portfolio-backup-offsite.service
install -m 0644 "$REPO_DIR/portfolio-backup-offsite.timer" /etc/systemd/system/portfolio-backup-offsite.timer

systemctl daemon-reload

if [[ ! -x /opt/portfolio/node/bin/node ]]; then
  echo "bootstrap: installing Node 18 into /opt/portfolio/node"
  "$REPO_DIR/install-node.sh"
fi

# rclone for the offsite push. A single static binary under /opt/portfolio/bin
# rather than an apt package: Buster is archived, and the host must not be
# dist-upgraded (see install-node.sh).
if [[ ! -x /opt/portfolio/bin/rclone ]]; then
  echo "bootstrap: installing rclone into /opt/portfolio/bin"
  "$REPO_DIR/install-rclone.sh"
fi

# First pull (may fail if pi-latest not published yet — OK)
/opt/portfolio/portfolio-update.sh || echo "first pull deferred until pi-latest exists"
systemctl enable --now portfolio.service || true
systemctl enable --now portfolio-update.timer
systemctl enable --now portfolio-snapshot.timer
systemctl enable --now portfolio-backup.timer

# The offsite push needs a storage remote and a backup public key, which are
# credentials this script cannot invent. Enable its timer only once someone has
# followed docs/runbooks/offsite-backup.md — an unconfigured unit failing every
# night just teaches you to ignore the journal.
if [[ -f /etc/portfolio-backup-offsite.env ]]; then
  systemctl enable --now portfolio-backup-offsite.timer
else
  echo "offsite push not configured — see docs/runbooks/offsite-backup.md"
fi
systemctl status portfolio.service --no-pager || true
systemctl list-timers 'portfolio-*.timer' --no-pager
