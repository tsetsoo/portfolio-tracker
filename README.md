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

```bash
# once on the Pi
scp -r deploy/pi raspberrypi:~/portfolio-deploy
ssh raspberrypi 'cd ~/portfolio-deploy && sudo ./install-node.sh && sudo ./bootstrap.sh'

# from this repo on your Mac (builds on the Pi)
./deploy/pi/sync-and-build.sh
```

Then open `http://raspberrypi:8081` or `http://100.118.255.23:8081` on the tailnet.
