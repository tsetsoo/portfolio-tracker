# Portfolio Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal Next.js + SQLite web app that values equities, crypto, and manual assets with lot-level cost basis, multi-currency totals, daily history, and desktop IBKR CSV import.

**Architecture:** Next.js App Router owns SQLite and all quote/FX calls. Pure domain functions value lots and P&L; quote providers sit behind a small interface with a TTL cache; the dashboard orchestrates refresh → value → optional daily snapshot. Desktop gets a sidebar shell with Import; mobile is a stacked read-focused home with no Import link.

**Tech Stack:** Next.js 15 (App Router, TypeScript), better-sqlite3, Vitest, Recharts (history chart), papaparse (IBKR CSV), Yahoo Finance quotes + CoinGecko + Frankfurter FX.

**Spec:** `docs/superpowers/specs/2026-07-25-portfolio-tracker-design.md`

## Global Constraints

- Personal use only — no auth in v1
- Quote/API keys never exposed to the client
- IBKR import is desktop-only (no Import nav on mobile)
- Base currency defaults to `EUR`, user-configurable
- SQLite file lives in `data/portfolio.db` (gitignored)
- Prefer small focused modules; pure domain logic testable without Next.js
- TDD for domain/parser/valuation; UI verified manually per task

---

## File structure

```
portfolio-tracker/
  package.json
  vitest.config.ts
  next.config.ts
  tsconfig.json
  .gitignore
  .env.example
  data/.gitkeep
  app/
    layout.tsx
    globals.css
    page.tsx                    # Home dashboard
    holdings/page.tsx
    import/page.tsx             # Desktop IBKR import
    settings/page.tsx
    actions/
      portfolio.ts              # refresh, CRUD server actions
      import.ts
      settings.ts
  lib/
    db/
      client.ts                 # better-sqlite3 singleton
      migrate.ts                # schema + migrations
    domain/
      types.ts
      lots.ts                   # qty, weighted avg cost
      valuation.ts              # P&L, convert to base
    quotes/
      types.ts
      equity-yahoo.ts
      crypto-coingecko.ts
      fx-frankfurter.ts
      service.ts                # getQuote / getFxRate + cache
    portfolio/
      value-portfolio.ts        # orchestration + outdated flag
      snapshots.ts
    ibkr/
      parse.ts
      commit.ts
    settings.ts
    format.ts
  components/
    AppShell.tsx
    NetWorthHeader.tsx
    OutdatedBanner.tsx
    HistoryChart.tsx
    HoldingsList.tsx            # mobile-simple
    HoldingsTable.tsx           # desktop dense
    HoldingForm.tsx
    ImportWizard.tsx
    SettingsForm.tsx
  tests/
    lots.test.ts
    valuation.test.ts
    ibkr-parse.test.ts
    snapshots.test.ts
    fixtures/
      ibkr-trades-sample.csv
```

---

### Task 1: Scaffold Next.js app + Vitest + git

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `data/.gitkeep`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: none
- Produces: runnable `npm run dev`, `npm test`

- [ ] **Step 1: Init git and ignore secrets/data**

```bash
cd /Users/tsvetelinpantev/programming/portfolio-tracker
git init
```

`.gitignore` must include:

```
node_modules/
.next/
data/*.db
data/*.db-*
.env
.env.local
.superpowers/
.DS_Store
```

- [ ] **Step 2: Create Next.js + Vitest package**

```bash
npx create-next-app@latest . --typescript --eslint --app --src-dir=false --tailwind=false --import-alias="@/*" --turbopack --yes
# If directory not empty, scaffold manually with same deps instead of create-next-app
npm install better-sqlite3 papaparse recharts
npm install -D vitest @types/better-sqlite3 @types/papaparse
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

Add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

`.env.example`:

```
DATABASE_PATH=./data/portfolio.db
# optional
FINNHUB_API_KEY=
```

- [ ] **Step 3: Write smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run test**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: scaffold Next.js portfolio tracker with Vitest

EOF
)"
```

---

### Task 2: SQLite schema and migrations

**Files:**
- Create: `lib/db/client.ts`, `lib/db/migrate.ts`, `lib/domain/types.ts`
- Test: `tests/db-migrate.test.ts`

**Interfaces:**
- Consumes: `DATABASE_PATH` env (default `./data/portfolio.db`)
- Produces:
  - `getDb(): Database` — singleton better-sqlite3 connection
  - `migrate(db: Database): void` — creates tables + default settings
  - Types: `HoldingType = "equity" | "crypto" | "manual"`, `Holding`, `Lot`, `Settings`

- [ ] **Step 1: Write failing migration test**

```ts
// tests/db-migrate.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/migrate";

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles) fs.rmSync(f, { force: true });
});

describe("migrate", () => {
  it("creates tables and default EUR base currency", () => {
    const file = path.join(os.tmpdir(), `pt-${Date.now()}.db`);
    tmpFiles.push(file);
    const db = new Database(file);
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "settings",
        "holdings",
        "lots",
        "price_cache",
        "fx_rates",
        "snapshots",
      ]),
    );
    const settings = db.prepare("SELECT base_currency FROM settings WHERE id = 1").get() as {
      base_currency: string;
    };
    expect(settings.base_currency).toBe("EUR");
    db.close();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/db-migrate.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement types + migrate + client**

`lib/domain/types.ts` — define `HoldingType`, `Holding`, `Lot`, `Settings`, `Quote`, `ValuedHolding`, `PortfolioValuation`.

`lib/db/migrate.ts` SQL:

```sql
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_currency TEXT NOT NULL DEFAULT 'EUR'
);
INSERT OR IGNORE INTO settings (id, base_currency) VALUES (1, 'EUR');

CREATE TABLE IF NOT EXISTS holdings (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('equity','crypto','manual')),
  symbol TEXT,
  name TEXT NOT NULL,
  quote_currency TEXT,
  manual_value REAL,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY,
  holding_id TEXT NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  quantity REAL NOT NULL,
  cost_per_unit REAL NOT NULL,
  cost_currency TEXT NOT NULL,
  purchased_at TEXT NOT NULL,
  fees REAL NOT NULL DEFAULT 0,
  external_trade_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS price_cache (
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (symbol, asset_class)
);

CREATE TABLE IF NOT EXISTS fx_rates (
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (from_currency, to_currency)
);

CREATE TABLE IF NOT EXISTS snapshots (
  date TEXT PRIMARY KEY,
  total_base REAL NOT NULL,
  breakdown_json TEXT NOT NULL
);
```

`lib/db/client.ts`: open DB at `process.env.DATABASE_PATH ?? "./data/portfolio.db"`, `pragma foreign_keys = ON`, call `migrate` on first get.

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/db-migrate.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db lib/domain/types.ts tests/db-migrate.test.ts
git commit -m "$(cat <<'EOF'
feat: add SQLite schema and migrations

EOF
)"
```

---

### Task 3: Lot aggregation and valuation (pure)

**Files:**
- Create: `lib/domain/lots.ts`, `lib/domain/valuation.ts`, `lib/format.ts`
- Test: `tests/lots.test.ts`, `tests/valuation.test.ts`

**Interfaces:**
- Consumes: `Lot`, `Holding` types
- Produces:
  - `aggregateLots(lots: Lot[]): { quantity: number; avgCostPerUnit: number | null; totalCostNative: number; costCurrency: string | null }`
  - `convertAmount(amount: number, from: string, to: string, rates: Record<string, number>): number` — `rates` keyed `"USD>EUR"` meaning multiply USD by rate to get EUR; identity if from===to
  - `valueHolding(input: ValueHoldingInput): ValuedHolding` where input includes holding, lots, price (nullable), fx rates map, baseCurrency

- [ ] **Step 1: Failing tests for lots**

```ts
// tests/lots.test.ts
import { describe, expect, it } from "vitest";
import { aggregateLots } from "@/lib/domain/lots";

describe("aggregateLots", () => {
  it("computes quantity and weighted average cost", () => {
    const result = aggregateLots([
      {
        id: "1",
        holdingId: "h",
        quantity: 10,
        costPerUnit: 100,
        costCurrency: "EUR",
        purchasedAt: "2024-01-01",
        fees: 0,
        externalTradeId: null,
      },
      {
        id: "2",
        holdingId: "h",
        quantity: 10,
        costPerUnit: 120,
        costCurrency: "EUR",
        purchasedAt: "2024-06-01",
        fees: 0,
        externalTradeId: null,
      },
    ]);
    expect(result.quantity).toBe(20);
    expect(result.avgCostPerUnit).toBe(110);
    expect(result.totalCostNative).toBe(2200);
    expect(result.costCurrency).toBe("EUR");
  });

  it("returns null avg for empty lots", () => {
    expect(aggregateLots([]).avgCostPerUnit).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL, then implement `aggregateLots`, re-run PASS**

- [ ] **Step 3: Failing tests for valuation**

```ts
// tests/valuation.test.ts
import { describe, expect, it } from "vitest";
import { convertAmount, valueHolding } from "@/lib/domain/valuation";

describe("convertAmount", () => {
  it("converts using rate map", () => {
    expect(convertAmount(100, "USD", "EUR", { "USD>EUR": 0.9 })).toBe(90);
  });
  it("identity when same currency", () => {
    expect(convertAmount(50, "EUR", "EUR", {})).toBe(50);
  });
});

describe("valueHolding", () => {
  it("values equity with P&L in base", () => {
    const valued = valueHolding({
      holding: {
        id: "h1",
        type: "equity",
        symbol: "VWCE.DE",
        name: "VWCE",
        quoteCurrency: "EUR",
        manualValue: null,
        notes: null,
        updatedAt: "2026-01-01",
      },
      lots: [
        {
          id: "l1",
          holdingId: "h1",
          quantity: 10,
          costPerUnit: 100,
          costCurrency: "EUR",
          purchasedAt: "2024-01-01",
          fees: 0,
          externalTradeId: null,
        },
      ],
      price: { price: 120, currency: "EUR" },
      baseCurrency: "EUR",
      fxRates: {},
    });
    expect(valued.quantity).toBe(10);
    expect(valued.avgCostPerUnit).toBe(100);
    expect(valued.currentValueBase).toBe(1200);
    expect(valued.costBasisBase).toBe(1000);
    expect(valued.unrealizedPlBase).toBe(200);
    expect(valued.unrealizedPlPct).toBeCloseTo(20);
  });

  it("manual without cost has null P&L", () => {
    const valued = valueHolding({
      holding: {
        id: "c1",
        type: "manual",
        symbol: null,
        name: "Cash EUR",
        quoteCurrency: "EUR",
        manualValue: 5000,
        notes: null,
        updatedAt: "2026-01-01",
      },
      lots: [],
      price: null,
      baseCurrency: "EUR",
      fxRates: {},
    });
    expect(valued.currentValueBase).toBe(5000);
    expect(valued.unrealizedPlBase).toBeNull();
  });
});
```

- [ ] **Step 4: Implement `convertAmount` + `valueHolding`, run tests PASS**

Rules:
- Equity/crypto current = qty × price, convert price currency → base
- Cost basis: each lot `qty * costPerUnit + fees`, convert lot currency → base, sum
- Manual: `manualValue` in `quoteCurrency` (or base if unset), convert to base; P&L only if lots present

- [ ] **Step 5: Commit**

```bash
git add lib/domain tests/lots.test.ts tests/valuation.test.ts
git commit -m "$(cat <<'EOF'
feat: add lot aggregation and holding valuation

EOF
)"
```

---

### Task 4: Quote + FX service with cache

**Files:**
- Create: `lib/quotes/types.ts`, `lib/quotes/equity-yahoo.ts`, `lib/quotes/crypto-coingecko.ts`, `lib/quotes/fx-frankfurter.ts`, `lib/quotes/service.ts`
- Test: `tests/quotes-service.test.ts` (mock `fetch`)

**Interfaces:**
- Consumes: `getDb()`, price_cache / fx_rates tables
- Produces:
  - `getQuote(symbol: string, assetClass: "equity" | "crypto", opts?: { force?: boolean }): Promise<{ price: number; currency: string; stale: boolean; fetchedAt: string }>`
  - `getFxRate(from: string, to: string, opts?: { force?: boolean }): Promise<{ rate: number; stale: boolean }>`
  - TTL: 10 minutes; on network error return cached row with `stale: true` if present, else throw

- [ ] **Step 1: Failing test with mocked fetch + temp DB**

```ts
// tests/quotes-service.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/migrate";

// Test will set DATABASE_PATH and reset module singleton — implement getDb to read env each call in tests OR export createQuoteService(db, fetchFn)

describe("quote service cache", () => {
  it("returns cached price within TTL without refetch", async () => {
    // arrange: insert price_cache row fetched_at = now
    // mock fetch — must NOT be called on second getQuote
    // assert price and stale === false
  });

  it("marks stale when fetch fails but cache exists", async () => {
    // arrange: old cache
    // mock fetch reject
    // force refresh → returns cache with stale true
  });
});
```

Implement `createQuoteService(db, fetchImpl)` so tests inject mocks; production `lib/quotes/service.ts` exports helpers using `getDb()` + global `fetch`.

- [ ] **Step 2: Implement Yahoo chart/quote fetch**

`equity-yahoo.ts`: `GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d` → `meta.regularMarketPrice` and `meta.currency`.

`crypto-coingecko.ts`: map common symbols (`BTC` → `bitcoin`) via small table; `GET https://api.coingecko.com/api/v3/simple/price?ids={id}&vs_currencies=eur,usd` — prefer base currency if available else USD.

`fx-frankfurter.ts`: `GET https://api.frankfurter.app/latest?from={from}&to={to}` → `rates[to]`.

- [ ] **Step 3: Wire cache read/write in service; tests PASS**

- [ ] **Step 4: Commit**

```bash
git add lib/quotes tests/quotes-service.test.ts
git commit -m "$(cat <<'EOF'
feat: add quote and FX providers with SQLite cache

EOF
)"
```

---

### Task 5: Portfolio valuation + daily snapshots

**Files:**
- Create: `lib/portfolio/value-portfolio.ts`, `lib/portfolio/snapshots.ts`, `lib/settings.ts`
- Test: `tests/snapshots.test.ts`, `tests/value-portfolio.test.ts`

**Interfaces:**
- Consumes: holdings/lots from DB, `getQuote`, `getFxRate`, `valueHolding`
- Produces:
  - `getSettings(db): Settings` / `setBaseCurrency(db, code: string): void`
  - `valuePortfolio(db, opts?: { forceRefresh?: boolean }): Promise<PortfolioValuation>`  
    `{ baseCurrency, totalBase, totalCostBase, unrealizedPlBase, holdings: ValuedHolding[], pricesOutdated: boolean, asOf: string }`
  - `ensureTodaySnapshot(db, valuation: PortfolioValuation, today: string): boolean` — inserts if missing; returns whether inserted
  - `listSnapshots(db): { date: string; totalBase: number }[]`

- [ ] **Step 1: Snapshot day-boundary test**

```ts
// tests/snapshots.test.ts
it("writes snapshot only once per date", () => {
  // migrate temp db, call ensureTodaySnapshot twice with same date
  // expect row count 1; second call returns false
});
```

- [ ] **Step 2: Implement snapshots + settings; test PASS**

- [ ] **Step 3: valuePortfolio integration test with stubbed quotes**

Inject quote/fx functions or stub cache rows so no network: one equity lot + one manual → totals match hand calculation; `pricesOutdated` true if any quote returned stale.

- [ ] **Step 4: Commit**

```bash
git add lib/portfolio lib/settings.ts tests/snapshots.test.ts tests/value-portfolio.test.ts
git commit -m "$(cat <<'EOF'
feat: value full portfolio and write daily snapshots

EOF
)"
```

---

### Task 6: Holdings CRUD server actions

**Files:**
- Create: `app/actions/portfolio.ts`, `lib/holdings-repo.ts`
- Test: `tests/holdings-repo.test.ts`

**Interfaces:**
- Produces (repo + actions):
  - `listHoldingsWithLots(db)`
  - `createHolding({ type, name, symbol?, quoteCurrency?, manualValue?, lot? })`
  - `addLot(holdingId, lotFields)`
  - `updateManualValue(holdingId, value)`
  - `deleteHolding(id)`
  - Server actions wrap these and `revalidatePath`

- [ ] **Step 1: Repo tests — create equity with initial lot; create manual; delete cascades lots**

- [ ] **Step 2: Implement repo with `crypto.randomUUID()` ids; actions thin wrappers

- [ ] **Step 3: Commit**

```bash
git add lib/holdings-repo.ts app/actions/portfolio.ts tests/holdings-repo.test.ts
git commit -m "$(cat <<'EOF'
feat: holdings and lots CRUD

EOF
)"
```

---

### Task 7: App shell + Home dashboard UI

**Files:**
- Create: `components/AppShell.tsx`, `NetWorthHeader.tsx`, `OutdatedBanner.tsx`, `HistoryChart.tsx`, `HoldingsList.tsx`, `HoldingsTable.tsx`, `app/layout.tsx` (update), `app/page.tsx`, `app/globals.css`
- Modify: CSS variables for a clear non-generic look (avoid purple-gradient / cream-serif AI defaults; pick a restrained financial utilitarian direction: deep ink + muted green for gains)

**Interfaces:**
- Home server component calls `valuePortfolio` + `ensureTodaySnapshot` + `listSnapshots`
- `AppShell`: desktop sidebar links Home / Holdings / Import / Settings; mobile top bar with Home + Settings only (no Import)
- Use CSS: `@media (min-width: 900px)` for sidebar vs stacked

- [ ] **Step 1: Implement `AppShell` with responsive nav (Import only in desktop sidebar)**

- [ ] **Step 2: Home page — total, P&L, outdated banner, Recharts line from snapshots, mobile list + desktop table**

- [ ] **Step 3: Refresh button → server action `forceRefreshPortfolio`**

- [ ] **Step 4: Manual check**

Run: `npm run dev`  
- Add seed via temporary script or SQLite: one manual cash holding  
- Confirm mobile width hides Import; desktop shows sidebar with Import  
- Confirm empty chart OK; total shows

- [ ] **Step 5: Commit**

```bash
git add app components
git commit -m "$(cat <<'EOF'
feat: responsive dashboard shell and home valuation UI

EOF
)"
```

---

### Task 8: Holdings + Settings pages

**Files:**
- Create: `app/holdings/page.tsx`, `components/HoldingForm.tsx`, `app/settings/page.tsx`, `components/SettingsForm.tsx`, `app/actions/settings.ts`

- [ ] **Step 1: Holdings page lists valued holdings; expand shows lots (qty, cost/unit, date, fees)**

- [ ] **Step 2: Form to add crypto (symbol + qty + cost/unit + currency + date) or manual (name + value + currency)**

- [ ] **Step 3: Settings page — change base currency (ISO code text input, uppercase); save via action; revalidate home**

- [ ] **Step 4: Manual check — add BTC lot, set base EUR, see value on home

- [ ] **Step 5: Commit**

```bash
git add app/holdings app/settings components/HoldingForm.tsx components/SettingsForm.tsx app/actions/settings.ts
git commit -m "$(cat <<'EOF'
feat: holdings management and base currency settings

EOF
)"
```

---

### Task 9: IBKR CSV parser

**Files:**
- Create: `lib/ibkr/parse.ts`, `tests/fixtures/ibkr-trades-sample.csv`, `tests/ibkr-parse.test.ts`

**Interfaces:**
- Produces: `parseIbkrTradesCsv(csvText: string): ParseResult`  
  ```ts
  type ParseResult = {
    rows: Array<{
      symbol: string;
      quantity: number;
      costPerUnit: number;
      costCurrency: string;
      purchasedAt: string; // ISO date
      fees: number;
      externalTradeId: string | null;
    }>;
    errors: Array<{ line: number; message: string }>;
  };
  ```
- Accept Flex Query “Trades” style headers: `Symbol`, `Quantity`, `TradePrice` / `T. Price`, `CurrencyPrimary` / `Currency`, `DateTime` / `TradeDate`, `IBCommission` / `Comm/Fee`, `TradeID` / `TransactionID` (normalize flexibly)
- Only include rows with positive buy quantity (quantity > 0); skip sells for v1 (record error or skip silently — **skip sells**, note in errors as skipped sell)
- Empty/invalid file → errors, empty rows

- [ ] **Step 1: Create fixture CSV with 2 buys + 1 sell + 1 bad row**

- [ ] **Step 2: Failing parser tests — 2 buy rows parsed; sell skipped; bad row in errors; trade ids set**

- [ ] **Step 3: Implement with papaparse; tests PASS**

- [ ] **Step 4: Commit**

```bash
git add lib/ibkr/parse.ts tests/ibkr-parse.test.ts tests/fixtures
git commit -m "$(cat <<'EOF'
feat: parse IBKR Flex trades CSV into lots

EOF
)"
```

---

### Task 10: IBKR import commit + desktop Import UI

**Files:**
- Create: `lib/ibkr/commit.ts`, `app/actions/import.ts`, `app/import/page.tsx`, `components/ImportWizard.tsx`
- Test: `tests/ibkr-commit.test.ts`

**Interfaces:**
- `previewIbkrImport(db, csvText): { toInsert; duplicates; errors }` — parse + check existing `external_trade_id`
- `commitIbkrImport(db, rows): { inserted: number }` — transaction: upsert equity holding by symbol, insert lots; rollback on failure
- Duplicate trade ids counted as duplicates, not inserted

- [ ] **Step 1: Commit tests — insert 2 lots; re-import same trade ids → 0 inserted, 2 duplicates**

- [ ] **Step 2: Implement preview + commit**

- [ ] **Step 3: ImportWizard client component — file input, preview table, confirm button calling server actions**

- [ ] **Step 4: `app/import/page.tsx` wrapped so it’s reachable on desktop; still no mobile nav link (direct URL OK)**

- [ ] **Step 5: Manual — import fixture CSV, see VWCE (or fixture symbols) on home with cost/unit

- [ ] **Step 6: Commit**

```bash
git add lib/ibkr/commit.ts app/actions/import.ts app/import components/ImportWizard.tsx tests/ibkr-commit.test.ts
git commit -m "$(cat <<'EOF'
feat: IBKR CSV preview and transactional import

EOF
)"
```

---

### Task 11: README + end-to-end smoke

**Files:**
- Create: `README.md`

- [ ] **Step 1: Document setup**

```md
# Portfolio Tracker

Personal net-worth tracker (Next.js + SQLite).

## Setup
npm install
cp .env.example .env.local
npm run dev

## Tests
npm test

## IBKR
Desktop → Import → upload Flex/Activity trades CSV.
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`  
Expected: all PASS

- [ ] **Step 3: Manual E2E checklist**

- [ ] Home shows total after seed/import  
- [ ] Prices refresh (or outdated banner if offline)  
- [ ] History point created for today  
- [ ] Mobile: no Import in nav  
- [ ] Desktop: Import works  
- [ ] Settings changes base currency  

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: add setup and usage README

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Mixed asset types + live/manual pricing | 3, 4, 5, 6, 8 |
| Lot-level cost / unit + P&L | 3, 7, 8 |
| Multi-currency + base setting | 3, 4, 5, 8 |
| Daily snapshots + history chart | 5, 7 |
| IBKR CSV import | 9, 10 |
| Desktop Import / no mobile Import | 7, 10 |
| Quote failure → stale cache banner | 4, 5, 7 |
| SQLite + Next.js personal app | 1, 2 |
| Unit tests for parser/valuation/snapshots | 3, 5, 9, 10 |

## Self-review notes

- No TBD placeholders in tasks; providers named (Yahoo, CoinGecko, Frankfurter)
- Types use camelCase in TS domain; DB columns snake_case mapped in repo
- Sells skipped in IBKR v1 (aligned with non-goal of complex lot closing)
- `createQuoteService(db, fetch)` required so quote tests do not hit network
