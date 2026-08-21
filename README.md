# Portfolio Tracker

Personal net-worth tracker (Next.js + SQLite).

> **Security note:** This app has no authentication or authorization. Anyone
> who can reach it can view and edit your holdings. Run it only on localhost
> or behind your own auth/reverse proxy — do **not** expose it directly to
> the internet.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Tests

```bash
npm test
```

## Import (desktop)

- **Interactive Brokers** — Import → IBKR → Flex/Activity trades CSV (equities)
- **Binance** — Import → Binance → Spot Trade History (buys netted FIFO against sells) **or** Auto-Invest History (Success buys)
- **Crypto.com** — Import → Crypto.com → App or Exchange CSV (buys/sells/withdrawals netted FIFO; combine date-range exports first)

USDT/USDC lots convert via USD for FX. Unsupported CoinGecko symbols import as lots but stay unpriced until mapped.

## Raspberry Pi (Tailscale)

Same layout idea as the todo app (`/opt/todo` → `/opt/portfolio`). Listens on **`:8081`** so it does not clash with todo on `:8080`.

The app runs in a **`node:22-bullseye` container** on the Pi's existing Docker. The
host is Raspbian Buster and cannot run Node 20+ natively (its libstdc++ only goes
to `GLIBCXX_3.4.25`; Node 20+ needs `3.4.26`), so the container supplies its own
userspace and the host OS is left alone. `better-sqlite3` is native, so the image
that builds a release is the image that runs it — CI stamps the tag into the
release as `NODE_IMAGE` and `run-container.sh` reads it back. Releases without
that file predate containerisation and fall back to the host's Node 18.

```bash
# once on the Pi
scp -r deploy/pi raspberrypi:~/portfolio-deploy
ssh raspberrypi 'cd ~/portfolio-deploy && sudo ./install-node.sh && sudo ./bootstrap.sh'
```

Deploys happen through GitHub Actions: a push to `main` builds the armv7
artifact, publishes it as the `pi-latest` release, and the Pi's
`portfolio-update.timer` picks it up within ~2 minutes. To force one without a
code change, run the **Deploy Pi** workflow via `workflow_dispatch`.

Then open `http://raspberrypi:8081` or `http://100.118.255.23:8081` on the tailnet.

### Price alerts

Alerts are evaluated in-process every 10 minutes and delivered by a Telegram
bot. Create one with [@BotFather](https://t.me/botfather), message it once, and
read your chat id from
`https://api.telegram.org/bot<token>/getUpdates`. Then on the Pi:

```bash
# /opt/portfolio is root-owned, so pi cannot create a file in it: make the
# file first (empty, pi-owned, 0600), then fill it. The install line blanks an
# existing portfolio.env, which is fine because the tee below rewrites it.
sudo install -o pi -g pi -m 0600 /dev/null /opt/portfolio/portfolio.env
sudo -u pi tee /opt/portfolio/portfolio.env >/dev/null <<'EOF'
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=42424242
EOF
sudo systemctl restart portfolio
```

A Pi bootstrapped before this feature landed has no `portfolio.env` at all
(only re-running `bootstrap.sh` writes the template), which is why the
`install` line comes first — without it `tee` fails with `Permission denied`.
`run-container.sh` passes the file to Docker with `--env-file` when it exists.

The file lives outside `releases/`, so deploys never overwrite it. Without
both variables the scheduler runs and reports `telegram-not-configured`
without sending anything.

#### Known limitations

- **No edit action.** Changing an alert means deleting it and creating a new
  one, which resets a percent alert's anchor to the price at re-create time.
- **An alert's currency is frozen at create time.** Changing the portfolio base
  currency in Settings leaves existing alerts pinned to the old currency, and
  every pass then records `Quote currency … does not match alert currency …`
  instead of firing. Delete and re-create them after a base-currency change.
- **Equity alerts are limited by what Yahoo quotes in the base currency.** An
  alert stores its currency and never converts, so creation only succeeds if
  Yahoo returns the base currency for that ticker. Only EUR and GBP get
  exchange-suffix candidates (`.DE`, `.L`, …); with any other non-USD base
  currency just the bare ticker is tried, and a mismatch fails at create time
  with the opaque message `Yahoo quote currency mismatch for AAPL: USD != CHF`.
