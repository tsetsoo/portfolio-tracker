# Wallet crypto cost basis → EUR average (BTC / ETH / LINK)

**Date:** 2026-08-10  
**Status:** Approved for planning  
**Base currency:** EUR  
**Scope assets:** BTC, ETH, LINK on wallets (exchange dust / BCH / stocks out of scope)

## Goal

Every wallet unit of BTC / ETH / LINK is **costed**, **gift**, or **explicitly partial/unknown with a reason**. All monetary costs used for averages are in **EUR**. Produce a clear average cost per asset (gift excluded). Tax-jurisdiction rules are out of scope for this pass.

## Decisions (locked)

| Topic | Decision |
|--------|----------|
| Second ETH (~0.70 on `0xc3c4…`) | Keep as **true gift** (basis €0); revisit later |
| Stablecoins | Treat **USDT / USDC / BUSD / TUSD / FDUSD** as **USD** |
| FX timing | **Historical** USD→EUR on each consumed lot’s **`purchased_at`** (calendar date) |
| BGN | Existing official peg (`1 EUR = 1.95583 BGN`) — no API |
| Crypto-quoted lots (BNB, CRO, ETHW, …) | **Out of scope** for this pass; slices stay `partial` with missing currency named |
| Repair style | Re-run FIFO from CSVs → **UPDATE** `wallet_transfers` costs by `tx_hash`; **no wallet wipe** |
| Gift / manual | Never overwrite `cost_status = 'gift'`; preserve manual overrides if present |
| UI | v1 = **CLI/script report** (optional small API later); no tax estimator UI |
| Tax | No invented jurisdiction rules; ask before any tax sketch (likely BG later) |

## Current failure mode

Live `wallet_transfers` with `cost_status = 'partial'` all note *"Mixed lot currencies; some FX rates missing"*.

- `fx_rates` holds only a **latest** USD→EUR quote.
- `fifoFxFromDb` / `settleCostPieces` do **not** alias USDT→USD and are **not date-aware**.
- Mixed withdrawals therefore drop USDT (etc.) slices → understated EUR basis (e.g. Binance ETH `0xabc4467c…` 1.375 ETH with **total** cost ≈ €3.26).

Open exchange BTC/ETH lots are dust; historical buys exist only in **CSV import fills**, not as remaining `lots` rows. Repair **must** re-run FIFO from CSVs.

## Architecture

```
CSVs (Binance spot/convert/auto-invest/withdraw + CDC)
        │
        ▼
  FIFO fills (buys + withdrawal sells)
        │
        ▼
  netFillsFifo(fills, datedFx)  ──► each lot piece: amount × rateToBase(ccy, purchasedAt)
        │
        ▼
  attachWithdrawalCosts → { txHash → cost EUR, status }
        │
        ▼
  UPDATE wallet_transfers (match tx_hash + asset; skip gift)
        │
        ▼
  Avg-cost report (qty buckets + Σ EUR + avg; gift called out)
```

### Components

1. **`fx_rates_daily`** — historical FX cache  
2. **`FifoFxLookup`** — alias + dated `rateToBase` + BGN peg  
3. **Frankfurter historical fetch** — populate daily USD→EUR  
4. **`settleCostPieces` / `CostPiece`** — carry `purchasedAt`; convert per lot date  
5. **Repair script** — prefetch FX → re-parse CSVs → UPDATE transfers on a DB copy, then Pi  
6. **Avg-cost report script** — BTC/ETH/LINK coverage + averages  

Existing quote-path `fx_rates` (latest) stays for live portfolio quotes; do not overload it with history.

## Data model

```sql
CREATE TABLE IF NOT EXISTS fx_rates_daily (
  rate_date TEXT NOT NULL,       -- YYYY-MM-DD (requested as-of date)
  from_currency TEXT NOT NULL,   -- normalized (USD, not USDT)
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,            -- multiply: amount_to = amount_from * rate
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (rate_date, from_currency, to_currency)
);
```

**Lookup order for `rateToBase(from, asOfDate)`:**

1. Normalize `from` via stablecoin→USD aliases; uppercase.  
2. If `from === base` → `1`.  
3. Read `fx_rates_daily` for `(asOfDate, from, base)` (and inverse if needed).  
4. BGN↔EUR peg when applicable.  
5. Else `null` (that piece does not contribute; settlement may be `partial`).

**Frankfurter weekends/holidays:** API returns the previous business day’s rate. Cache the rate under the **requested** `rate_date` so retries are stable.

**Prefetch:** collect distinct `purchased_at` dates from buy fills that can feed BTC/ETH/LINK withdrawals (and any other currencies that survive aliasing to USD/EUR/BGN). Fetch missing USD→EUR rows before FIFO.

## FIFO changes

- Extend cost pieces to `{ currency, amount, purchasedAt }`.  
- On each lot take, pass the lot’s `purchasedAt` (date portion).  
- `settleCostPieces`: convert every piece with dated FX into `fx.baseCurrency` (EUR).  
- `partial: true` if any piece had `rateToBase === null`; `cost_notes` should list missing currencies (improve on today’s generic note).  
- If all pieces convert → `costed`, `costCurrency = EUR`.

`createFifoFxLookup` / `fifoFxFromDb` gain:

- stablecoin aliases (same set as quote service),  
- sync reader over `fx_rates_daily` (Frankfurter is **prefetched** before `netFillsFifo`; no network inside settle),  
- `rateToBase(from, asOfDate?: string)` (if date omitted, fall back to latest `fx_rates` or peg only — repair path always passes dates).

## Repair pipeline

**Inputs (Mac Downloads; paths configurable):**

- Binance Withdraw History (identity for withdraws — not ledger Transaction History alone)  
- Binance Spot / Convert / Auto-Invest  
- CDC `crypto_transactions_record_*.csv`

**Steps:**

1. Copy live DB → `.tmp-reimport/` (gitignored).  
2. Migrate `fx_rates_daily` if needed.  
3. Prefetch historical USD→EUR for required purchase dates.  
4. Re-run Binance unified withdraw FIFO + CDC withdrawal cost path with dated FX.  
5. For each computed withdrawal cost, `UPDATE wallet_transfers` set `cost_basis`, `cost_currency='EUR'`, `cost_status`, `cost_notes` where `tx_hash` (+ asset) match and `cost_status != 'gift'`.  
6. Do **not** delete wallets, addresses, token balances, or gift rows.  
7. Sanity-check: ETH `0xabc4467c…` per-unit cost must be in a plausible historical band (thousands of EUR/ETH for late 2023), not ~€2–3. If still absurd → stop and inspect lot mix before Pi apply.  
8. Apply the same UPDATE path on Pi (SSH) after local verification.

**Full reimport + wallet restore** remains a fallback only if cost-only UPDATE cannot attach (hash mismatch); prefer additive repair.

## Avg-cost report (v1)

Per asset (BTC, ETH, LINK), portfolio-wide and optionally per wallet:

| Field | Definition |
|--------|------------|
| `qty_on_chain` | Wallet / token balance (truth) |
| `qty_costed` | Σ transfer amounts with `cost_status = 'costed'` |
| `qty_partial` | Σ `partial` |
| `qty_gift` | Σ `gift` |
| `qty_unknown` | `max(0, qty_on_chain − costed − partial − gift)` (fees may make covered > balance; clamp coverage display at 100%) |
| `cost_eur_costed` | Σ `cost_basis` for `costed` (EUR) |
| `avg_eur_tax_ready` | `cost_eur_costed / qty_costed` (omit if qty_costed = 0) |
| `cost_eur_partial` | Σ basis for `partial` (best-effort; not mixed into tax-ready avg) |
| Gift line | qty + basis €0 called out separately |

Optional: spot price and unrealized (`spot × qty − basis`) for orientation only — **not** a tax figure.

## Error handling

- Missing Frankfurter date → leave that date uncached; affected pieces `partial`; report lists dates/currencies still missing.  
- Withdrawal tx not found in DB → log; do not insert new transfers in repair mode.  
- Hash match but amount mismatch beyond tolerance → log warning; still update cost if user confirms, else skip.  
- Pi apply only after local sanity gates pass.

## Testing

- Unit: stablecoin alias; BGN peg; dated rate hit/miss; mixed EUR+USDT settles fully when USD→EUR present for purchase dates; missing CRO → partial with leftover EUR from convertible slices.  
- Unit: `attachWithdrawalCosts` status/notes.  
- Integration (local DB copy): repair reduces BTC/ETH/LINK partial qty; anomaly ETH withdraw leaves plausible €/unit; gifts unchanged.  
- Report: gift ETH excluded from avg; coverage math matches balances.

## Out of scope

- Tax jurisdiction / taxable gain estimator UI  
- Historical crypto→EUR (BNB, CRO, ETHW, …)  
- Re- basing gift ETH from `0x11ba7b…`  
- BCH wallet, other exchange dust, equities  
- Committing `.tmp-reimport/` (contains xpub / DB copies)

## Success criteria

1. BTC / ETH / LINK wallet units are costed, gift, or partial/unknown with named missing FX/crypto currencies.  
2. Costed (and convertible partial slices) expressed in EUR using purchase-date USD→EUR (stables as USD).  
3. Report shows per-asset Σ EUR cost and avg (€/unit), gift excluded.  
4. Document remaining unverifiable units (e.g. CRO-funded BTC slice) and what would unblock them.  
5. No wallet wipe; gifts preserved.

## Code map (touch points)

- `lib/import/fifo-net.ts` — pieces + dated settle  
- `lib/import/fifo-fx.ts` — aliases + daily lookup  
- `lib/quotes/fx-frankfurter.ts` — historical URL  
- `lib/db/migrate.ts` — `fx_rates_daily`  
- `lib/binance/commit.ts` / `parse.ts`, `lib/cryptocom/commit.ts` / `parse.ts` — pass dated FX (already use `fifoFxFromDb`)  
- `lib/wallets/repo.ts` — optional targeted cost UPDATE helper  
- New: repair + report scripts under `scripts/`  
- `lib/wallets/cost-coverage.ts` — unchanged coverage semantics unless report needs a sibling helper
