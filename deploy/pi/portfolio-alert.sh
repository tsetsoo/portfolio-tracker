#!/usr/bin/env bash
set -uo pipefail
# Send a Telegram message when a systemd unit fails.
#
# Wired up with `OnFailure=portfolio-alert@%n.service` on any unit worth being
# told about. Until now every failure here was loud in the journal and silent
# everywhere else, which only helps if someone thinks to look — and the whole
# point of the backup is that you find out it broke *before* you need it.
#
# Reuses the bot the alerts feature already configures in
# /opt/portfolio/portfolio.env, so there is no new credential.
#
# Deliberately best-effort: this runs *because* something already failed, so it
# must never make things worse. Every path exits 0.

UNIT="${1:-unknown.service}"
ENV_FILE="${PORTFOLIO_ENV:-/opt/portfolio/portfolio.env}"
LINES="${ALERT_LOG_LINES:-12}"

log() { echo "portfolio-alert: $*"; }

if [[ ! -r "$ENV_FILE" ]]; then
  log "no readable $ENV_FILE — cannot send an alert for $UNIT"
  exit 0
fi
# shellcheck source=/dev/null
source "$ENV_FILE"

TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT="${TELEGRAM_CHAT_ID:-}"
if [[ -z "$TOKEN" || -z "$CHAT" ]]; then
  log "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set in $ENV_FILE — no alert for $UNIT"
  exit 0
fi

result="$(systemctl show -p Result --value "$UNIT" 2>/dev/null || echo unknown)"
# The last few journal lines are the whole point: they carry the script's own
# explanation, which is what makes the alert actionable rather than just noisy.
detail="$(journalctl -u "$UNIT" -n "$LINES" --no-pager --output=cat 2>/dev/null \
  | grep -avE 'no overview data found for' | tail -n "$LINES")"
[[ -n "$detail" ]] || detail="(no journal output)"

text="$(printf '⚠️ %s failed on %s\n\nresult: %s\n\n%s' \
  "$UNIT" "$(hostname)" "$result" "$detail")"

# --data-urlencode so newlines and any shell metacharacters in the log survive.
# --max-time so a hung network cannot leave this unit running forever.
response="$(curl -sS --max-time 30 \
  -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT}" \
  --data-urlencode "text=${text}" \
  --data-urlencode "disable_notification=false" 2>&1)" || {
    log "curl failed sending the alert for $UNIT"
    exit 0
  }

if printf '%s' "$response" | grep -q '"ok":true'; then
  log "alerted on $UNIT"
else
  # Telegram's error body is the only clue when the token or chat id is wrong.
  log "Telegram rejected the alert for $UNIT: $(printf '%s' "$response" | head -c 200)"
fi
exit 0
