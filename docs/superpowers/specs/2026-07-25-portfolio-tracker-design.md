# Portfolio Tracker — Design Spec

**Date:** 2026-07-25  
**Status:** Approved for implementation planning  
**Location:** `portfolio-tracker/` (greenfield)

## Problem

Track the current value of a mixed personal portfolio — equities/ETFs, crypto, and manual assets (cash, real estate, pensions) — with cost basis for tax awareness, multi-currency totals, and value history over time.

## Goals (v1)

- See total net worth in a configurable base currency, plus native currency values
- Live prices for equities/ETFs and crypto; manual values for non-market assets
- Per-unit / lot-level cost basis, average cost, and unrealized P&L (€ and %)
- Daily portfolio snapshots and a value-over-time chart
- IBKR Flex/Activity CSV import for stocks/ETFs (desktop only)
- Personal use only: no multi-user auth in v1

## Non-goals (v1)

- Broker API sync (IBKR API, crypto exchange APIs)
- Crypto trade import (manual entry for now)
- Full tax filing / country-specific tax reports
- Dividends, wash sales, complex sell-lot matching UI (simple lot edits suffice)
- Mobile IBKR import
- Multi-user accounts / OAuth

## Approach

**Next.js (App Router) + SQLite**, single personal deploy (local or small VPS). All quote API keys stay server-side. No auth in v1.

## Architecture

```
Browser UI → Next.js App Router → SQLite
                    ↓
              Quote providers (equity, crypto, FX)
                    ↓
              Daily snapshots ← written on first successful valuation per day
```

- UI loads dashboard → server reads holdings/lots → refreshes stale price/FX cache → values positions → returns totals, table, chart data
- IBKR import (desktop): upload CSV → preview → transactional commit of holdings + lots

## Data model

### Holding types

| Type | Pricing | Quantity |
|------|---------|----------|
| `equity` | Live quote by ticker | From sum of lots |
| `crypto` | Live quote by symbol | From sum of lots |
| `manual` | User-entered value | Optional; value is primary |

### Tables

- **settings** — base currency (default `EUR`), display prefs
- **holdings** — id, type, symbol/name, quote_currency, notes, manual_value (for manuals), updated_at
- **lots** — holding_id, quantity, cost_per_unit, cost_currency, purchased_at, fees, external_trade_id (nullable, unique when set for IBKR dedupe)
- **price_cache** — symbol, asset_class, price, currency, fetched_at
- **fx_rates** — from_currency, to_currency, rate, fetched_at
- **snapshots** — date (unique), total_base, breakdown_json (per-holding values in base)

### Valuation & P&L

- Current value (marketable) = quantity × live price (quote currency → base via FX)
- Cost basis = Σ (lot qty × cost_per_unit) converted to base
- Unrealized P&L = current − cost (absolute and %); shown when cost exists
- Manual holdings without cost: show value only (no fabricated P&L)
- UI exposes **cost per unit** (weighted average) and lot detail for tax thinking

### Multi-currency

- Configurable base currency (default EUR)
- Dashboard shows native and base values side by side where useful
- FX rates cached similarly to prices

## Pricing & snapshots

- Internal interface: `getQuote(symbol, assetClass)` with separate equity vs crypto providers
- **Default providers (swappable behind the interface):**
  - Equities/ETFs: Yahoo Finance quote endpoint (unofficial; no API key) or Finnhub if a key is configured
  - Crypto: CoinGecko simple price API
  - FX: Frankfurter (ECB rates, no key)
- Cache TTL ~5–15 minutes; on provider failure, serve last cache with “prices may be outdated” banner
- Manual refresh control on dashboard
- On first successful full valuation each calendar day, write a snapshot if none exists for that date
- History chart reads snapshots only (no intraday series in v1)

## IBKR import

- Desktop-only route/section; not linked from mobile UI
- Accept IBKR Flex / Activity CSV upload
- Parse buys into lots: symbol, qty, price, currency, date, commission/fees, trade id when present
- Create equity holdings as needed
- Preview before commit: new lots, skipped duplicates, parse errors
- Commit in a single SQLite transaction; unknown symbols / bad rows do not block valid rows (errors listed in preview)
- Duplicate `external_trade_id` → skip and report count

## UI / UX

### Responsive layout

- **Mobile:** stacked focus — large total, P&L summary, history chart, simple holdings list (name + value). Refresh + Settings only. **No Import.**
- **Desktop:** sidebar shell — Home, Holdings, Import, Settings. Denser holdings table with cost/unit, value, P&L. Import page: dropzone → preview → confirm.

### Primary screens

1. **Home** — net worth (base), gain/loss, allocation glance (desktop), history chart, holdings summary
2. **Holdings** — full list + drill into lots / edit manual values / add crypto or manual assets
3. **Import** (desktop) — IBKR CSV flow
4. **Settings** — base currency, optional display prefs

## Error handling

| Case | Behavior |
|------|----------|
| Quote/FX failure | Last cache + outdated banner |
| Partial import errors | Preview lists bad rows; good rows importable |
| Duplicate trade id | Skip + count |
| Invalid CSV | Clear error; no writes |
| DB write failure on import | Transaction rollback; nothing partial |

## Testing

- **Unit:** IBKR CSV parser; lot aggregation / weighted avg cost; FX conversion; P&L; snapshot day boundary
- **Manual:** add equity/crypto/manual; refresh prices; import sample Flex CSV; verify mobile has no Import and desktop layout works

## Project layout (intended)

```
portfolio-tracker/
  docs/superpowers/specs/   # this document
  src/ or app/              # Next.js app
  data/                     # SQLite file (gitignored)
  ...
```

## Open follow-ups (post-v1)

- Crypto exchange / CSV import
- Simple password gate for VPS deploy
- FIFO lot close on sells
- Dividend tracking
