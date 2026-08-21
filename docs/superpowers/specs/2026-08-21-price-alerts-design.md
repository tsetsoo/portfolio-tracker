# Price Alerts via Telegram

Date: 2026-08-21

## Goal

Notify the owner over Telegram when a watched asset crosses a price level or
moves by a set percentage, without anyone having a browser open.

## Context

The app values the portfolio lazily: `lib/quotes/service.ts` fetches a quote
only when a page renders, and caches it in `price_cache` behind a 10-minute
TTL. Nothing runs on a schedule today except `portfolio-update.timer`, which
polls GitHub for new releases. Alerts therefore need a process that ticks on
its own.

The app runs on a Raspberry Pi inside a `node:22-bullseye` container, reachable
only over Tailscale. It has no public URL, so a Telegram **webhook** is
impossible; the bot must be send-only or long-poll. Send-only is enough for
this feature.

## Decisions

| Question | Decision |
| --- | --- |
| Trigger types | Asset price threshold, and asset percent move. No portfolio-total or P&L alerts |
| Control surface | Web UI for all CRUD; the Telegram bot only sends |
| Symbol scope | Any supported symbol, not just held assets |
| Re-fire rule | Cooldown window — an alert may fire again after `cooldown_minutes`, default 24h |
| Percent baseline | Rolling anchor recorded by us, re-anchored on each fire |
| What ticks | In-process `setInterval` started from `instrumentation.ts`, every 10 minutes |
| Fire history | Not stored. `last_fired_at` / `last_checked_at` / `last_error` on the row |
| Delivery config | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` from env |

### Why in-process rather than a systemd timer

The Pi already runs the app 24/7 under `portfolio.service` with
`Restart=on-failure`, so an interval inside the server needs no new units and
no second `bootstrap.sh` run. The accepted trade-off is that the scheduler dies
with the app: a container that is down produces silence, not a warning. That
failure is visible — the dashboard is down too.

A `POST /api/alerts/run` route exists alongside the interval. It gives a manual
trigger, an integration-test seam, and the endpoint a systemd timer would curl
if the trigger ever moves out of process.

## Architecture

Five modules, each independently testable:

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `lib/alerts/types.ts` | `PriceAlert`, `AlertKind`, `AlertDirection`, `NewAlert` | — |
| `lib/alerts/repo.ts` | SQLite CRUD, no network | `better-sqlite3` |
| `lib/alerts/evaluate.ts` | Pure decision: does this alert fire? | types only |
| `lib/alerts/run.ts` | One pass: fetch quotes, evaluate, send, record | repo, evaluate, injected quote service + notifier |
| `lib/alerts/telegram.ts` | The only file that knows Telegram exists | injected `fetch` |
| `lib/alerts/scheduler.ts` | Interval lifecycle, started once | run |

`runAlerts` receives its quote service and notifier as arguments, following
`createQuoteService(db, fetchImpl)`. Tests inject fakes and touch no network.

## Data model

One new table, created inside the existing `db.exec` block in
`lib/db/migrate.ts`:

```sql
CREATE TABLE IF NOT EXISTS price_alerts (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL CHECK (asset_class IN ('equity','crypto')),
  kind TEXT NOT NULL CHECK (kind IN ('threshold','percent_move')),
  direction TEXT NOT NULL,
  target_price REAL,
  percent REAL,
  anchor_price REAL,
  anchor_at TEXT,
  currency TEXT NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldown_minutes INTEGER NOT NULL DEFAULT 1440,
  last_fired_at TEXT,
  last_checked_at TEXT,
  last_price REAL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (kind = 'threshold'
      AND direction IN ('above','below')
      AND target_price IS NOT NULL
      AND percent IS NULL)
    OR (kind = 'percent_move'
      AND direction IN ('up','down','either')
      AND percent IS NOT NULL AND percent > 0
      AND anchor_price IS NOT NULL
      AND target_price IS NULL)
  )
);
```

The `CHECK` makes the two alert kinds mutually exclusive at the storage layer,
so no code path can persist a threshold alert with a percentage or a percent
alert without an anchor.

`currency` is resolved once at create time and then frozen, so a row is
self-describing: "BTC ≥ €100,000" keeps its meaning after the base currency
changes. If a later quote resolves in a different currency, the pass records an
error instead of comparing two currencies.

`percent` is stored as a fraction (`0.05` for 5%).

Both kinds record `anchor_price` and `anchor_at` at create time: for a percent
alert it is the moving baseline, and for a threshold alert it is a fixed
reference the notification quotes ("was €96,400 when you set this"). A
threshold alert's anchor is never rewritten.

## Creating an alert

Alerts are not restricted to held assets, so `createAlertAction` validates the
symbol before inserting:

- **crypto** — `coingeckoIdForSymbol(symbol)`. `null` rejects the alert with a
  message naming the constraint: the supported set is the `COINGECKO_IDS` map in
  `lib/quotes/crypto-coingecko.ts` (30 symbols), and an unmapped symbol must be
  added there first. Failing loudly at create time is the point; the
  alternative is an alert that can never fire and never says why.
- **equity** — one `fetchYahooQuote(symbol, fetch, { preferredCurrency })`,
  which both proves the ticker resolves and returns its currency.

The validation price does double duty: it becomes `anchor_price` for a percent
alert, and for a threshold it lets the form show the current price so the user
does not set a level that is already crossed.

## Evaluation

One pass, every 10 minutes:

1. Load alerts with `enabled = 1`, group by asset class.
2. Crypto symbols go through `getCryptoQuotes(symbols)` — a single CoinGecko
   request for the whole set. Equities are one Yahoo request each.
3. Fetch on the normal cache path, without `force`. A 10-minute interval against
   the 10-minute TTL fetches fresh every pass and warms `price_cache` for the
   dashboard as a side effect.
4. **Stale quotes never fire.** When `quote.stale` is true the provider failed
   and the service fell back to cache; record `last_error` and skip. A stale
   price crossing a threshold is not news.
5. **Threshold** fires when `direction = 'above' && price >= target_price`, or
   `direction = 'below' && price <= target_price`.
6. **Percent move** computes `move = (price - anchor_price) / anchor_price` and
   fires when `Math.abs(move) >= percent` and the sign agrees with `direction`
   (`up` needs `move > 0`, `down` needs `move < 0`, `either` accepts both).
   The form defaults to `either`, matching how a "±5%" alert is usually meant.
7. **Cooldown gates everything.** If `last_fired_at` is within
   `cooldown_minutes` of now, skip without sending.
8. **On a successful send** set `last_fired_at = now`, and for a percent alert
   re-anchor `anchor_price` to the firing price with `anchor_at = now`. A
   sustained drift therefore re-fires once per cooldown from each new level,
   which is what a cooldown window implies.
9. Every alert gets `last_checked_at` and `last_price` recorded, fired or not,
   so the UI can show that checks are actually happening.

Errors are per-alert: an unresolvable symbol records `last_error` and leaves
the alert enabled, so fixing the symbol map revives it without re-creating it.

## Delivery

`lib/alerts/telegram.ts` POSTs to
`https://api.telegram.org/bot<token>/sendMessage` with `chat_id` and plain
text. One message per fired alert — at most a handful per pass, and separate
messages read better on a phone than a merged digest. Amounts format through
the existing `formatMoney`, which already falls back to `1,234.56 CODE` for
non-ISO codes.

```
🔔 BTC 105,240.00 € — crossed above 100,000.00 €
   (was 96,400.00 € when you set this)
```

A non-2xx response throws. When a send fails the alert is **not** marked fired:
`last_error` is recorded and the next pass retries. Cooldown thus starts from a
delivered message, so a Telegram outage delays alerts rather than eating them.

When `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is unset, a pass evaluates
nothing and returns `{ skipped: "telegram-not-configured" }`, and `/alerts`
shows a banner saying so.

## UI

- **`/alerts`** — `app/alerts/page.tsx` plus `components/AlertsManager.tsx`,
  built from the existing `Card`, `Field`, `Button`, and `DataTable` primitives.
  Rows show symbol, condition, current price, and status (armed, cooling down
  until *T*, or the recorded error), with enable/disable and delete.
- A new sidebar entry in `components/AppShell.tsx`.
- **`app/actions/alerts.ts`** — create, update, delete, toggle, send test
  message, run now; shaped like `app/actions/wallets.ts`.
- **Settings** gains a "Send test message" button, so the token can be verified
  without waiting for a real crossing.

## Configuration

`.env.example`:

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
# optional
ALERTS_INTERVAL_MS=600000
```

The scheduler starts only when `NODE_ENV=production` or `ALERTS_ENABLED=1`, so
`npm run dev` on a laptop does not fire duplicate messages into the same chat
from a different database.

On the Pi, `deploy/pi/run-container.sh` hardcodes its `--env` list, so it gains
`--env-file /opt/portfolio/portfolio.env` when that file exists. The file sits
outside `releases/`, so deploys never overwrite the token. `bootstrap.sh`
creates a `0600` template and the README documents filling it in.

## Testing

Vitest, with an in-memory `Database` run through `migrate`, matching the
existing suites.

| Test | Covers |
| --- | --- |
| `tests/alerts-evaluate.test.ts` | threshold above/below; cooldown suppression; percent up/down/either; re-anchor on fire; stale quote skipped; currency mismatch |
| `tests/alerts-repo.test.ts` | CRUD; the `CHECK` rejecting malformed kind/direction rows; `recordFire` updating the anchor |
| `tests/alerts-run.test.ts` | fake quote service and notifier: crypto batched into one call; notifier failure leaves the alert unfired and retryable; unsupported symbol records an error |
| `tests/alerts-telegram.test.ts` | request URL and payload via stub `fetch`; non-200 throws |
| `tests/alerts-ui.test.tsx` | `AlertsManager` rendering, in the style of `dashboard-ui.test.tsx` |
| `tests/db-migrate.test.ts` | extended for the new table |
| `tests/sidebar-nav.test.tsx` | extended for the new nav entry |

## Out of scope

- Inbound Telegram commands (no long polling, no webhook).
- Portfolio-total and position-P&L triggers.
- Alert fire history beyond the last check on each row.
- Multiple recipients or chats.
