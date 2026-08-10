# Wallet cost basis EUR average Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-settle wallet BTC/ETH/LINK withdrawal costs into EUR using purchase-date USD→EUR (USDT/USDC as USD), update transfers without wiping wallets, and report per-asset average cost (gift excluded).

**Architecture:** Prefetch Frankfurter historical USD→EUR into `fx_rates_daily`, extend FIFO settlement to convert each consumed lot on its `purchased_at` date (stablecoin aliases + BGN peg), re-run Binance/CDC CSV FIFO to UPDATE existing `wallet_transfers` (skip gifts), then emit an avg-cost report.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, Frankfurter API, existing `netFillsFifo` / Binance+CDC import paths, `npx tsx` scripts.

## Global Constraints

- Base currency: EUR
- Scope assets: BTC, ETH, LINK on wallets only
- USDT / USDC / BUSD / TUSD / FDUSD → USD alias
- FX: historical USD→EUR on each lot’s `purchased_at` date
- BGN↔EUR: peg `1 EUR = 1.95583 BGN` (no API)
- BNB / CRO / ETHW → EUR: out of scope; leave those slices `partial` with currency named
- Second ETH gift (~0.70): never overwrite `cost_status = 'gift'`
- No full wallet wipe / restore unless cost-only UPDATE cannot attach
- Do not commit `.tmp-reimport/`
- Pi BigInt: no `0n` literals
- Spec: `docs/superpowers/specs/2026-08-10-wallet-cost-basis-eur-design.md`

## File structure

| File | Responsibility |
|------|----------------|
| `lib/quotes/fx-aliases.ts` | Stablecoin → USD normalization (shared) |
| `lib/quotes/fx-frankfurter.ts` | Latest + historical Frankfurter fetch |
| `lib/import/fx-daily.ts` | Read/upsert/prefetch `fx_rates_daily` |
| `lib/db/migrate.ts` | Create `fx_rates_daily` |
| `lib/import/fifo-net.ts` | Dated `rateToBase`, cost pieces with `purchasedAt`, `missingCurrencies` |
| `lib/import/fifo-fx.ts` | Wire aliases + daily rates into `FifoFxLookup` |
| `lib/cryptocom/parse.ts` | `WithdrawalCost.missingCurrencies`; richer partial notes |
| `lib/binance/commit.ts` | Pass through `missingCurrencies` when mapping consumed → WithdrawalCost |
| `lib/wallets/repo.ts` | `applyWithdrawalCostsSkippingGift` |
| `lib/wallets/avg-cost-report.ts` | Pure report aggregation |
| `scripts/repair-wallet-costs.ts` | Prefetch FX → CSV FIFO → apply costs on a DB path |
| `scripts/report-wallet-avg-cost.ts` | Print avg-cost report for a DB |
| `tests/fx-aliases.test.ts` | Alias unit tests |
| `tests/fx-frankfurter.test.ts` | Historical URL/parse tests |
| `tests/fx-daily.test.ts` | Daily cache + prefetch |
| `tests/fifo-net-cost.test.ts` | Extend dated USDT settle + partial CRO |
| `tests/db-migrate.test.ts` | Expect `fx_rates_daily` |
| `tests/wallets-cost-repair.test.ts` | Gift skip + cost UPDATE |
| `tests/wallets-avg-cost-report.test.ts` | Report math |

---

### Task 1: FX aliases + historical Frankfurter

**Files:**
- Create: `lib/quotes/fx-aliases.ts`
- Modify: `lib/quotes/fx-frankfurter.ts`
- Modify: `lib/quotes/service.ts` (use shared aliases)
- Test: `tests/fx-aliases.test.ts`, `tests/fx-frankfurter.test.ts`

**Interfaces:**
- Produces: `normalizeFxCurrency(code: string): string`; `FX_STABLECOIN_ALIASES`; `fetchFrankfurterRateOnDate(from, to, date, fetchImpl): Promise<number>`

- [ ] **Step 1: Write failing alias tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizeFxCurrency } from "@/lib/quotes/fx-aliases";

describe("normalizeFxCurrency", () => {
  it("aliases stablecoins to USD and uppercases", () => {
    expect(normalizeFxCurrency("usdt")).toBe("USD");
    expect(normalizeFxCurrency("USDC")).toBe("USD");
    expect(normalizeFxCurrency("BUSD")).toBe("USD");
    expect(normalizeFxCurrency("eur")).toBe("EUR");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `npx vitest run tests/fx-aliases.test.ts`
Expected: FAIL cannot find module

- [ ] **Step 3: Implement aliases + refactor service**

```ts
// lib/quotes/fx-aliases.ts
export const FX_STABLECOIN_ALIASES: Record<string, string> = {
  USDT: "USD",
  USDC: "USD",
  BUSD: "USD",
  TUSD: "USD",
  FDUSD: "USD",
};

export function normalizeFxCurrency(code: string): string {
  const upper = code.trim().toUpperCase();
  return FX_STABLECOIN_ALIASES[upper] ?? upper;
}
```

In `lib/quotes/service.ts`, delete local `FX_ALIASES` / `normalizeFxCurrency` and import from `@/lib/quotes/fx-aliases`.

- [ ] **Step 4: Write failing historical Frankfurter test**

```ts
import { describe, expect, it, vi } from "vitest";
import { fetchFrankfurterRateOnDate } from "@/lib/quotes/fx-frankfurter";

describe("fetchFrankfurterRateOnDate", () => {
  it("requests the dated endpoint and returns the rate", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ rates: { EUR: 0.92 } }), { status: 200 }),
    );
    await expect(
      fetchFrankfurterRateOnDate("USD", "EUR", "2022-04-21", fetchImpl),
    ).resolves.toBe(0.92);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      "https://api.frankfurter.app/2022-04-21?from=USD&to=EUR",
    );
  });
});
```

- [ ] **Step 5: Implement historical fetch**

```ts
export async function fetchFrankfurterRateOnDate(
  from: string,
  to: string,
  date: string,
  fetchImpl: typeof fetch,
): Promise<number> {
  const day = date.slice(0, 10);
  const url =
    `https://api.frankfurter.app/${encodeURIComponent(day)}` +
    `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Frankfurter request failed (${response.status})`);
  }
  const payload = (await response.json()) as FrankfurterResponse;
  const rate = payload.rates?.[to];
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    throw new Error("Frankfurter returned an invalid rate");
  }
  return rate;
}
```

Keep existing `fetchFrankfurterRate` (latest) unchanged.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/fx-aliases.test.ts tests/fx-frankfurter.test.ts tests/quotes-service.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/quotes/fx-aliases.ts lib/quotes/fx-frankfurter.ts lib/quotes/service.ts \
  tests/fx-aliases.test.ts tests/fx-frankfurter.test.ts
git commit -m "feat: shared FX aliases and historical Frankfurter fetch"
```

---

### Task 2: `fx_rates_daily` table + prefetch helper

**Files:**
- Modify: `lib/db/migrate.ts` (add `CREATE TABLE IF NOT EXISTS fx_rates_daily` in main `db.exec` block)
- Create: `lib/import/fx-daily.ts`
- Test: `tests/db-migrate.test.ts`, `tests/fx-daily.test.ts`

**Interfaces:**
- Consumes: `fetchFrankfurterRateOnDate`, `normalizeFxCurrency`
- Produces:
  - `getDailyFxRate(db, from, to, rateDate): number | null`
  - `upsertDailyFxRate(db, from, to, rateDate, rate): void`
  - `prefetchUsdEurDailyRates(db, dates: string[], fetchImpl): Promise<{ fetched: number; failed: string[] }>`

- [ ] **Step 1: Extend migrate test expectation**

In `tests/db-migrate.test.ts` first test, add `"fx_rates_daily"` to `expect.arrayContaining([...])`.

- [ ] **Step 2: Run migrate test — expect FAIL**

Run: `npx vitest run tests/db-migrate.test.ts`
Expected: FAIL missing `fx_rates_daily`

- [ ] **Step 3: Add table to migrate**

Inside the main `db.exec(\`...\`)` block after `fx_rates`:

```sql
CREATE TABLE IF NOT EXISTS fx_rates_daily (
  rate_date TEXT NOT NULL,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (rate_date, from_currency, to_currency)
);
```

- [ ] **Step 4: Write fx-daily tests**

```ts
import Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@/lib/db/migrate";
import {
  getDailyFxRate,
  prefetchUsdEurDailyRates,
  upsertDailyFxRate,
} from "@/lib/import/fx-daily";

describe("fx-daily", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
  });
  afterEach(() => db.close());

  it("round-trips a daily rate", () => {
    upsertDailyFxRate(db, "USD", "EUR", "2022-04-21", 0.92);
    expect(getDailyFxRate(db, "USD", "EUR", "2022-04-21")).toBe(0.92);
    expect(getDailyFxRate(db, "USDT", "EUR", "2022-04-21")).toBe(0.92); // alias
  });

  it("prefetches missing USD→EUR dates via Frankfurter", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ rates: { EUR: 0.91 } }), { status: 200 }),
    );
    const result = await prefetchUsdEurDailyRates(
      db,
      ["2022-04-21", "2022-04-21"],
      fetchImpl,
    );
    expect(result.fetched).toBe(1);
    expect(result.failed).toEqual([]);
    expect(getDailyFxRate(db, "USD", "EUR", "2022-04-21")).toBe(0.91);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5: Implement `lib/import/fx-daily.ts`**

- Normalize currencies with `normalizeFxCurrency` before read/write.
- Store under the **requested** `rate_date` (YYYY-MM-DD).
- `prefetchUsdEurDailyRates`: unique dates; skip if row exists; on success upsert; on failure push date to `failed` (do not throw for the whole batch).

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/db-migrate.test.ts tests/fx-daily.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/db/migrate.ts lib/import/fx-daily.ts tests/db-migrate.test.ts tests/fx-daily.test.ts
git commit -m "feat: add fx_rates_daily cache and USD/EUR prefetch"
```

---

### Task 3: Dated FIFO settlement + missing currencies

**Files:**
- Modify: `lib/import/fifo-net.ts`
- Test: `tests/fifo-net-cost.test.ts`

**Interfaces:**
- Consumes: none new
- Produces: `FifoFxLookup.rateToBase(fromCurrency: string, asOfDate?: string): number | null`; `FifoConsumed.missingCurrencies?: string[]`; `createFifoFxLookup` accepts `getDailyRate?: (from, to, date) => number | null` and applies stablecoin aliases via `normalizeFxCurrency`

- [ ] **Step 1: Write failing dated USDT + CRO tests**

Append to `tests/fifo-net-cost.test.ts`:

```ts
  it("converts USDT lots using dated rateToBase(purchasedAt)", () => {
    const rates: Record<string, number> = { "2021-02-14": 0.83 };
    const fx = createFifoFxLookup({
      baseCurrency: "EUR",
      getDailyRate: (from, to, date) =>
        from === "USD" && to === "EUR" ? rates[date] ?? null : null,
    });
    const fills: LotFill[] = [
      {
        line: 2,
        order: 0,
        sortKey: "2021-02-14T10:00:00",
        side: "BUY",
        row: {
          symbol: "ETH",
          quantity: 1,
          costPerUnit: 1000,
          costCurrency: "USDT",
          purchasedAt: "2021-02-14",
          fees: 0,
          externalTradeId: "buy-usdt",
        },
      },
      {
        line: 3,
        order: 1,
        sortKey: "2021-03-01T10:00:00",
        side: "SELL",
        disposition: "withdrawal",
        row: {
          symbol: "ETH",
          quantity: 1,
          costPerUnit: 0,
          costCurrency: "EUR",
          purchasedAt: "2021-03-01",
          fees: 0,
          externalTradeId: "wd:0x1",
        },
      },
    ];
    const result = netFillsFifo(fills, fx);
    expect(result.consumed[0]!.costBasis).toBeCloseTo(830);
    expect(result.consumed[0]!.costCurrency).toBe("EUR");
    expect(result.consumed[0]!.partial).toBeFalsy();
  });

  it("marks partial and lists missing crypto quote currencies", () => {
    const fx = createFifoFxLookup({
      baseCurrency: "EUR",
      getDailyRate: () => 0.9,
    });
    const fills: LotFill[] = [
      {
        line: 2,
        order: 0,
        sortKey: "2022-01-01T10:00:00",
        side: "BUY",
        row: {
          symbol: "BTC",
          quantity: 0.5,
          costPerUnit: 10000,
          costCurrency: "EUR",
          purchasedAt: "2022-01-01",
          fees: 0,
          externalTradeId: "buy-eur",
        },
      },
      {
        line: 3,
        order: 1,
        sortKey: "2022-08-20T10:00:00",
        side: "BUY",
        row: {
          symbol: "BTC",
          quantity: 0.5,
          costPerUnit: 100,
          costCurrency: "CRO",
          purchasedAt: "2022-08-20",
          fees: 0,
          externalTradeId: "buy-cro",
        },
      },
      {
        line: 4,
        order: 2,
        sortKey: "2022-08-21T10:00:00",
        side: "SELL",
        disposition: "withdrawal",
        row: {
          symbol: "BTC",
          quantity: 1,
          costPerUnit: 0,
          costCurrency: "EUR",
          purchasedAt: "2022-08-21",
          fees: 0,
          externalTradeId: "wd:btc",
        },
      },
    ];
    const result = netFillsFifo(fills, fx);
    expect(result.consumed[0]!.partial).toBe(true);
    expect(result.consumed[0]!.costBasis).toBeCloseTo(5000);
    expect(result.consumed[0]!.missingCurrencies).toEqual(["CRO"]);
  });
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run tests/fifo-net-cost.test.ts`
Expected: FAIL (USDT not aliased / no getDailyRate / no missingCurrencies)

- [ ] **Step 3: Implement in `fifo-net.ts`**

1. Change `FifoFxLookup.rateToBase` to `(fromCurrency: string, asOfDate?: string) => number | null`.
2. Extend `CostPiece` with `purchasedAt: string`.
3. When pushing pieces from a lot, include `lot.purchasedAt`.
4. In `settleCostPieces`, call `fx.rateToBase(currency, piece.purchasedAt.slice(0, 10))`; collect missing currency codes into a sorted unique list; return `{ ..., partial, missingCurrencies }`.
5. Put `missingCurrencies` on `FifoConsumed` when partial.
6. Update `createFifoFxLookup`:
   - import `normalizeFxCurrency`
   - options: `getRate?: (from, to) => number | null`, `getDailyRate?: (from, to, date) => number | null`
   - `rateToBase(fromCurrency, asOfDate?)`: normalize from; same-currency → 1; if `asOfDate` and `getDailyRate`, try daily direct/inverse; else `getRate` direct/inverse; then BGN peg; else null.

- [ ] **Step 4: Run fifo-net tests**

Run: `npx vitest run tests/fifo-net-cost.test.ts`
Expected: PASS (including existing BGN/EUR test)

- [ ] **Step 5: Commit**

```bash
git add lib/import/fifo-net.ts tests/fifo-net-cost.test.ts
git commit -m "feat: date-aware FIFO FX settle with missing currency list"
```

---

### Task 4: Wire `fifoFxFromDb` to daily rates + aliases

**Files:**
- Modify: `lib/import/fifo-fx.ts`
- Test: `tests/fx-daily.test.ts` (add integration case) or new `tests/fifo-fx.test.ts`

**Interfaces:**
- Consumes: `getDailyFxRate`, `createFifoFxLookup`
- Produces: `fifoFxFromDb(db)` whose `rateToBase('USDT', '2022-04-21')` reads daily USD→EUR

- [ ] **Step 1: Write failing wiring test**

```ts
// tests/fifo-fx.test.ts
import Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { migrate } from "@/lib/db/migrate";
import { upsertDailyFxRate } from "@/lib/import/fx-daily";
import { fifoFxFromDb } from "@/lib/import/fifo-fx";

describe("fifoFxFromDb", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    db.prepare("UPDATE settings SET base_currency = 'EUR' WHERE id = 1").run();
  });
  afterEach(() => db.close());

  it("aliases USDT and uses fx_rates_daily for the purchase date", () => {
    upsertDailyFxRate(db, "USD", "EUR", "2021-02-14", 0.83);
    const fx = fifoFxFromDb(db);
    expect(fx.rateToBase("USDT", "2021-02-14")).toBeCloseTo(0.83);
    expect(fx.rateToBase("BGN")).toBeCloseTo(1 / 1.95583);
  });
});
```

- [ ] **Step 2: Implement `fifoFxFromDb`**

```ts
import { getDailyFxRate } from "@/lib/import/fx-daily";
import { createFifoFxLookup } from "@/lib/import/fifo-net";
import { getSettings } from "@/lib/settings";

export function fifoFxFromDb(db: Database.Database): FifoFxLookup {
  const baseCurrency = getSettings(db).baseCurrency;
  return createFifoFxLookup({
    baseCurrency,
    getRate: (from, to) => {
      const row = db
        .prepare(
          `SELECT rate FROM fx_rates
           WHERE UPPER(from_currency) = UPPER(?)
             AND UPPER(to_currency) = UPPER(?)
           LIMIT 1`,
        )
        .get(from, to) as { rate: number } | undefined;
      return row?.rate ?? null;
    },
    getDailyRate: (from, to, date) => getDailyFxRate(db, from, to, date),
  });
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/fifo-fx.test.ts tests/fifo-net-cost.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/import/fifo-fx.ts tests/fifo-fx.test.ts
git commit -m "feat: wire fifoFxFromDb to daily FX rates"
```

---

### Task 5: Propagate `missingCurrencies` into withdrawal cost notes

**Files:**
- Modify: `lib/cryptocom/parse.ts` (`WithdrawalCost`, `attachWithdrawalCosts`, mapping from `netted.consumed`)
- Modify: `lib/binance/commit.ts` (map `missingCurrencies` in `previewBinanceWithdrawFromDb`)
- Modify: `lib/binance/parse.ts` if it maps consumed → WithdrawalCost
- Test: `tests/cryptocom-parse.test.ts` or small new unit test on `attachWithdrawalCosts`

**Interfaces:**
- Produces: `WithdrawalCost.missingCurrencies?: string[]`; partial notes like `Mixed lot currencies; missing FX for: CRO`

- [ ] **Step 1: Write failing attachWithdrawalCosts note test**

```ts
import { describe, expect, it } from "vitest";
import { attachWithdrawalCosts } from "@/lib/cryptocom/parse";

it("writes missing FX currencies into costNotes when partial", () => {
  const rows = attachWithdrawalCosts(
    [
      {
        chain: "btc",
        asset: "BTC",
        amount: 1,
        txHash: "abc",
        transferredAt: "2022-08-20",
      },
    ],
    [
      {
        externalTradeId: "abc",
        asset: "BTC",
        quantity: 1,
        costBasis: 5000,
        costCurrency: "EUR",
        partial: true,
        missingCurrencies: ["CRO"],
      },
    ],
  );
  expect(rows[0]!.costStatus).toBe("partial");
  expect(rows[0]!.costNotes).toContain("CRO");
});
```

(Place in `tests/cryptocom-parse.test.ts` or `tests/withdrawal-cost-notes.test.ts`.)

- [ ] **Step 2: Extend types + attachWithdrawalCosts + all consumed→WithdrawalCost mappers**

```ts
export type WithdrawalCost = {
  externalTradeId: string;
  asset: string;
  quantity: number;
  costBasis: number;
  costCurrency: string;
  partial?: boolean;
  missingCurrencies?: string[];
};
```

In `attachWithdrawalCosts`:

```ts
costNotes: cost.partial
  ? cost.missingCurrencies?.length
    ? `Mixed lot currencies; missing FX for: ${cost.missingCurrencies.join(", ")}`
    : "Mixed lot currencies; some FX rates missing"
  : row.costNotes,
```

When mapping `netted.consumed` → `WithdrawalCost`, copy `missingCurrencies: row.missingCurrencies`.

- [ ] **Step 3: Run related tests**

Run: `npx vitest run tests/cryptocom-parse.test.ts tests/binance-commit.test.ts tests/binance-parse.test.ts tests/withdrawal-cost-notes.test.ts`
Expected: PASS (ignore missing file if test lives elsewhere)

- [ ] **Step 4: Commit**

```bash
git add lib/cryptocom/parse.ts lib/binance/commit.ts lib/binance/parse.ts tests/
git commit -m "feat: name missing FX currencies on partial withdrawal costs"
```

---

### Task 6: Apply withdrawal costs skipping gifts

**Files:**
- Modify: `lib/wallets/repo.ts`
- Test: `tests/wallets-cost-repair.test.ts`

**Interfaces:**
- Produces: `applyWithdrawalCostsSkippingGift(db, withdrawals: ExchangeWithdrawalRow[]): { updated: number; skippedGift: number; unmatched: number }`

- [ ] **Step 1: Write failing tests**

Create `tests/wallets-cost-repair.test.ts` using in-memory `migrate`, insert a gift transfer and a partial transfer with known `tx_hash`, call apply, assert gift unchanged and partial updated to costed.

Use existing wallet test helpers/patterns from `tests/wallets-import.test.ts` if present (copy minimal insert SQL if needed).

- [ ] **Step 2: Implement**

```ts
export function applyWithdrawalCostsSkippingGift(
  db: Database.Database,
  withdrawals: ExchangeWithdrawalRow[],
): { updated: number; skippedGift: number; unmatched: number } {
  let updated = 0;
  let skippedGift = 0;
  let unmatched = 0;
  const select = db.prepare(
    `SELECT id, cost_status FROM wallet_transfers WHERE tx_hash = ?`,
  );
  for (const row of withdrawals) {
    if (row.costBasis == null || row.costStatus == null) continue;
    const txHash = normalizeTxHash(row.chain, row.txHash);
    if (!txHash) continue;
    const existing = select.get(txHash) as
      | { id: string; cost_status: string }
      | undefined;
    if (!existing) {
      unmatched += 1;
      continue;
    }
    if (existing.cost_status === "gift") {
      skippedGift += 1;
      continue;
    }
    updateTransferCost(db, existing.id, {
      costBasis: row.costBasis,
      costCurrency: row.costCurrency ?? "EUR",
      costStatus: row.costStatus,
      costNotes: row.costNotes ?? null,
    });
    updated += 1;
  }
  return { updated, skippedGift, unmatched };
}
```

Match on normalized `tx_hash` only (unique in schema). Optionally warn if `asset` differs (log in script, not required in repo).

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/wallets-cost-repair.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/wallets/repo.ts tests/wallets-cost-repair.test.ts
git commit -m "feat: apply withdrawal costs without overwriting gifts"
```

---

### Task 7: Avg-cost report helper

**Files:**
- Create: `lib/wallets/avg-cost-report.ts`
- Test: `tests/wallets-avg-cost-report.test.ts`
- Create: `scripts/report-wallet-avg-cost.ts`

**Interfaces:**
- Produces: `buildWalletAvgCostReport(db, assets?: string[]): WalletAvgCostReport`

Report shape:

```ts
export type AssetAvgCostRow = {
  asset: string;
  qtyOnChain: number;
  qtyCosted: number;
  qtyPartial: number;
  qtyGift: number;
  qtyUnknown: number;
  costEurCosted: number;
  avgEurTaxReady: number | null;
  costEurPartial: number;
  partialMissingNotes: string[];
};
```

- [ ] **Step 1: Write failing unit tests** for aggregation math (gift excluded from avg; unknown = max(0, onChain − costed − partial − gift); ETH token LINK from `wallet_token_balances`).

- [ ] **Step 2: Implement `buildWalletAvgCostReport`**

- Native balances: sum `wallets.balance` where `balance_asset` matches (or chain default BTC/ETH).
- LINK: sum `wallet_token_balances.balance` for asset LINK.
- Transfers: group by `UPPER(asset)` for status buckets and EUR sums (`cost_currency` uppercased EUR only for money sums; after repair all costed should be EUR).

- [ ] **Step 3: CLI script**

```bash
npx tsx --tsconfig tsconfig.json scripts/report-wallet-avg-cost.ts \
  --db .tmp-reimport/portfolio.live.audit.db
```

Print a readable table for BTC/ETH/LINK.

- [ ] **Step 4: Run tests + commit**

```bash
git add lib/wallets/avg-cost-report.ts tests/wallets-avg-cost-report.test.ts \
  scripts/report-wallet-avg-cost.ts
git commit -m "feat: wallet avg-cost report for BTC ETH LINK"
```

---

### Task 8: Repair script (CSV FIFO → apply costs)

**Files:**
- Create: `scripts/repair-wallet-costs.ts`

**Interfaces:**
- Consumes: `migrate`, `prefetchUsdEurDailyRates`, `fifoFxFromDb`, `previewBinanceImport` / `parseBinanceUnifiedWithdraw` path, `previewCryptoComImport`, `applyWithdrawalCostsSkippingGift`
- CLI flags: `--db`, repeatable `--cdc`, `--binance-spot`, `--binance-convert`, `--binance-auto`, `--binance-withdraw`, `--apply` (default dry-run prints summary only)

- [ ] **Step 1: Implement dry-run first**

Flow:

1. Open DB, `migrate(db)`.
2. Read CSV texts from flags.
3. Build Binance unified withdraw preview with spot/convert/auto + withdraw (same as `previewBinanceImport(..., "withdraw", { spotCsv, convertCsv, autoInvestCsv })`).
4. For each CDC file, `previewCryptoComImport` / parse path that yields `withdrawals`.
5. Collect all buy `purchasedAt` dates from fills used in those parsers **or** simpler: after a first FIFO pass, also collect dates by scanning: before FIFO, temporarily run with empty daily table is wrong — instead add helper `collectPurchaseDatesFromBinanceUnified` OR prefetch dates extracted by parsing buys only.

**Practical prefetch approach (required):**

- Add `lib/import/collect-purchase-dates.ts` OR inline in script:
  - Parse Binance spot/convert/auto + CDC into buy rows (reuse existing parse functions that return rows with `purchasedAt`).
  - Unique `purchasedAt.slice(0,10)`.
- `await prefetchUsdEurDailyRates(db, dates, fetch)`.
- Log `failed` dates; continue (those slices stay partial).

6. Re-run withdraw previews with `fifoFxFromDb(db)` (now populated).
7. Merge withdrawal rows; dry-run: print per tx proposed status/basis vs current.
8. With `--apply`: `applyWithdrawalCostsSkippingGift`.
9. Sanity gate: find transfer whose `tx_hash` starts with `0xabc4467c` (or full hash from DB); if `cost_basis/amount < 100` EUR still, **exit non-zero** and do not treat as success (when `--apply`, refuse apply if gate fails in dry-run check before apply).

Default CSV paths may be documented in script header comments pointing at Downloads filenames from the spec; do not hard-require them.

- [ ] **Step 2: Smoke on local copy (no apply)**

```bash
cp /path/from/pi-or-existing .tmp-reimport/portfolio.repair.db
# scp live if needed
npx tsx --tsconfig tsconfig.json scripts/repair-wallet-costs.ts \
  --db .tmp-reimport/portfolio.repair.db \
  --binance-withdraw "$HOME/Downloads/Binance-Withdraw-History-202608070714(UTC+3)-part1-of1.csv" \
  --binance-spot "$HOME/Downloads/Binance-Spot-Trade-History-202607271313(UTC+3)-part1-of1.csv" \
  --binance-convert "$HOME/Downloads/Binance-Convert-Order-History-202608070716(UTC+3)-part1-of1.csv" \
  --binance-auto "$HOME/Downloads/Binance-Auto-Invest-History-202607271314(UTC+3)-part1-of1.csv" \
  --cdc "$HOME/Downloads/crypto_transactions_record_20260727_111249.csv" \
  --cdc "$HOME/Downloads/crypto_transactions_record_20260727_111330.csv" \
  --cdc "$HOME/Downloads/crypto_transactions_record_20260727_111408.csv"
```

Expected: dry-run shows ETH `0xabc4467c…` jumping from ~€3 to thousands; most partials → costed; BTC may remain partial if CRO missing.

- [ ] **Step 3: Apply on copy + report**

```bash
npx tsx ... scripts/repair-wallet-costs.ts --db .tmp-reimport/portfolio.repair.db ... --apply
npx tsx ... scripts/report-wallet-avg-cost.ts --db .tmp-reimport/portfolio.repair.db
```

- [ ] **Step 4: Commit script only (not DB copies)**

```bash
git add scripts/repair-wallet-costs.ts lib/import/collect-purchase-dates.ts  # if created
git commit -m "feat: repair wallet transfer costs with dated FX from CSVs"
```

---

### Task 9: Verify remaining gaps + apply on Pi

**Files:**
- Optional note in chat / short `docs/superpowers/specs/` addendum only if user asks — prefer chat summary, no extra markdown unless needed

- [ ] **Step 1: Confirm gift ETH untouched** on repair DB (`cost_status='gift'`, basis 0, qty ~0.7046).

- [ ] **Step 2: List remaining `partial` BTC/ETH/LINK** with `cost_notes` (expect CRO etc.).

- [ ] **Step 3: Deploy code to Pi** via normal path (`git push` → Actions → `portfolio-update.sh`) **or** if user prefers not to push yet, `scp` built artifacts only after asking. Prefer: push branch when user OK.

- [ ] **Step 4: On Pi** — copy DB backup, run migrate via app start or script, run repair with CSVs present on Mac over SSH by copying CSVs + script execution against `/opt/portfolio/data/portfolio.db` **after backup**:

```bash
ssh pi@raspberrypi 'cp /opt/portfolio/data/portfolio.db /opt/portfolio/data/portfolio.pre-fx-$(date -u +%Y%m%dT%H%M%SZ).db'
```

Run repair from Mac with `--db` pointing at a freshly scp’d live DB, `--apply`, verify report, then scp DB back **only if** user explicitly wants DB scp workflow; otherwise run `npx tsx` on Pi if Node tooling exists under `/opt/portfolio`.

**Preferred Pi apply:** after deploy, from Mac:

```bash
scp ...csvs... pi@raspberrypi:/tmp/portfolio-csvs/
ssh pi@raspberrypi 'cd /opt/portfolio/current && ... repair ...'
```

If Pi cannot run tsx, apply costs on Mac against scp’d DB then `scp` DB back over the backup. Ask user before replacing live DB.

- [ ] **Step 5: Final report to user** — table of avg EUR/unit, remaining partial reasons, gift callout.

- [ ] **Step 6: Commit any small fixups** from verification (not `.tmp-reimport/`).

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| `fx_rates_daily` + Frankfurter historical | 1–2 |
| USDT/USDC aliases | 1, 3–4 |
| Purchase-date FX in settle | 3 |
| BGN peg unchanged | 3 (existing) |
| CRO/BNB out of scope / named partial | 3, 5 |
| CSV re-FIFO + UPDATE skip gift | 6, 8 |
| No wallet wipe | 8 |
| €3.26 sanity gate | 8 |
| Avg-cost report gift excluded | 7 |
| Pi apply + remaining gaps | 9 |
| Gift ETH kept | 6, 9 |

No TBD placeholders. `rateToBase` / `missingCurrencies` / `applyWithdrawalCostsSkippingGift` names consistent across tasks.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-wallet-cost-basis-eur.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
