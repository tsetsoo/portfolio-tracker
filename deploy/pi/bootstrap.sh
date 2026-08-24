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
# 0700, not 0755: this directory holds the financial database in the clear, and
# the host also runs pihole, homebridge, nginx and uwsgi. Both the app and its
# container run as pi, so nothing else needs to traverse it.
install -d -o pi -g pi -m 0700 /opt/portfolio/data
if [[ -f /opt/portfolio/data/portfolio.db ]]; then
  chmod 0600 /opt/portfolio/data/portfolio.db
fi
install -o root -g root -m 0755 "$REPO_DIR/portfolio-update.sh" /opt/portfolio/portfolio-update.sh
install -o root -g root -m 0755 "$REPO_DIR/run-container.sh" /opt/portfolio/run-container.sh
install -o root -g root -m 0755 "$REPO_DIR/portfolio-backup.sh" /opt/portfolio/portfolio-backup.sh
install -m 0644 "$REPO_DIR/portfolio.service" /etc/systemd/system/portfolio.service
install -m 0644 "$REPO_DIR/portfolio-update.service" /etc/systemd/system/portfolio-update.service
install -m 0644 "$REPO_DIR/portfolio-update.timer" /etc/systemd/system/portfolio-update.timer
install -m 0644 "$REPO_DIR/portfolio-snapshot.service" /etc/systemd/system/portfolio-snapshot.service
install -m 0644 "$REPO_DIR/portfolio-snapshot.timer" /etc/systemd/system/portfolio-snapshot.timer
install -m 0644 "$REPO_DIR/portfolio-backup.service" /etc/systemd/system/portfolio-backup.service
install -m 0644 "$REPO_DIR/portfolio-backup.timer" /etc/systemd/system/portfolio-backup.timer

systemctl daemon-reload

if [[ ! -x /opt/portfolio/node/bin/node ]]; then
  echo "bootstrap: installing Node 18 into /opt/portfolio/node"
  "$REPO_DIR/install-node.sh"
fi

# rclone for the off-device upload. A single static binary under /opt/portfolio/bin
# rather than an apt package: Buster is archived, and the host must not be
# dist-upgraded (see install-node.sh).
if [[ ! -x /opt/portfolio/bin/rclone ]]; then
  echo "bootstrap: installing rclone into /opt/portfolio/bin"
  # Non-fatal, like the first pull below: a download failure or a missing
  # unzip must not stop the app being deployed and its timers enabled.
  "$REPO_DIR/install-rclone.sh" || echo "bootstrap: rclone install failed — backup upload unavailable until it is rerun"
fi

# First pull (may fail if pi-latest not published yet — OK)
/opt/portfolio/portfolio-update.sh || echo "first pull deferred until pi-latest exists"
systemctl enable --now portfolio.service || true
systemctl enable --now portfolio-update.timer
systemctl enable --now portfolio-snapshot.timer

# Always on: without a bucket configured it still takes a verified local copy
# every night, which beats nothing. Getting it off the device needs a bucket and
# an encryption key that this script cannot invent.
systemctl enable --now portfolio-backup.timer
if [[ ! -f /etc/portfolio-backup.env ]]; then
  echo "backup: local copies only — see docs/runbooks/offsite-backup.md to get them off the device"
fi

systemctl status portfolio.service --no-pager || true
systemctl list-timers 'portfolio-*.timer' --no-pager
