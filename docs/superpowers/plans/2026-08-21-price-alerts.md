# Price Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a Telegram message when a watched asset crosses a price level or moves by a set percentage, evaluated on a 10-minute in-process schedule.

**Architecture:** A new `lib/alerts/` module with one responsibility per file — SQLite CRUD (`repo.ts`), a pure fire/no-fire decision (`evaluate.ts`), Telegram delivery (`telegram.ts`), an orchestrated pass (`run.ts`), and interval lifecycle (`scheduler.ts`). `runAlerts` receives its quote service and notifier as arguments, so every test injects fakes and touches no network. A `/alerts` page does all CRUD; the bot only sends.

**Tech Stack:** Next.js 15 (App Router, server actions, `instrumentation.ts`), better-sqlite3, Vitest, Tailwind v3, Telegram Bot HTTP API.

**Spec:** `docs/superpowers/specs/2026-08-21-price-alerts-design.md`

## Global Constraints

- **Alert kinds:** `threshold` and `percent_move` only. No portfolio-total or P&L alerts.
- **Percent storage:** `percent` is stored as a **fraction** (`0.05` for 5%). The UI collects whole percent and divides by 100 in the server action.
- **Currency:** resolved once at create time, stored on the row, never rewritten. A quote resolving in a different currency records an error instead of comparing.
- **Re-fire:** cooldown window, `cooldown_minutes` default `1440`.
- **Stale quotes never fire.** `quote.stale === true` records an error and skips.
- **A failed send never marks the alert fired** — `last_error` is recorded and the next pass retries.
- **Crypto symbols** are limited to the `COINGECKO_IDS` map in `lib/quotes/crypto-coingecko.ts`; reject unmapped symbols at create time with a message naming the map.
- **Scheduler runs only when** `NODE_ENV === "production"` or `ALERTS_ENABLED === "1"`.
- **Test style:** Vitest, `new Database(":memory:")` + `db.pragma("foreign_keys = ON")` + `migrate(db)`, `@/` alias, no network.
- **Import order** in every file: node builtins, external packages, then `@/` imports, alphabetised within each group (matches `lib/wallets/repo.ts`).

---

### Task 1: Table, types, repository

**Files:**
- Modify: `lib/db/migrate.ts` (inside the existing `db.exec` template literal, after the `wallet_addresses` table)
- Create: `lib/alerts/types.ts`
- Create: `lib/alerts/repo.ts`
- Test: `tests/alerts-repo.test.ts`
- Test: `tests/db-migrate.test.ts:32` (add `"price_alerts"` to the `arrayContaining` list)

**Interfaces:**
- Consumes: `migrate` from `@/lib/db/migrate`, `AssetClass` from `@/lib/quotes/types`.
- Produces: `PriceAlert`, `NewAlert`, `AlertKind`, `AlertDirection` types; `createAlert`, `listAlerts`, `listArmedAlerts`, `getAlert`, `setAlertEnabled`, `deleteAlert`, `recordCheck`, `recordFire`.

- [ ] **Step 1: Write the failing test**

Create `tests/alerts-repo.test.ts`:

```tsx
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createAlert,
  deleteAlert,
  getAlert,
  listAlerts,
  listArmedAlerts,
  recordCheck,
  recordFire,
  setAlertEnabled,
} from "@/lib/alerts/repo";
import { migrate } from "@/lib/db/migrate";

describe("alerts repository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates a threshold alert and maps database fields", () => {
    const alert = createAlert(db, {
      symbol: "btc",
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: 100_000,
      anchorPrice: 96_400,
      currency: "eur",
      label: "take profit",
    });

    expect(alert.id).toMatch(/[0-9a-f-]{36}/);
    expect(alert.symbol).toBe("BTC");
    expect(alert.currency).toBe("EUR");
    expect(alert.targetPrice).toBe(100_000);
    expect(alert.percent).toBeNull();
    expect(alert.anchorPrice).toBe(96_400);
    expect(alert.anchorAt).toBe(alert.createdAt);
    expect(alert.enabled).toBe(true);
    expect(alert.cooldownMinutes).toBe(1440);
    expect(alert.lastFiredAt).toBeNull();
    expect(getAlert(db, alert.id)).toEqual(alert);
  });

  it("creates a percent alert with an explicit cooldown", () => {
    const alert = createAlert(db, {
      symbol: "ETH",
      assetClass: "crypto",
      kind: "percent_move",
      direction: "either",
      percent: 0.05,
      anchorPrice: 3_000,
      currency: "EUR",
      cooldownMinutes: 120,
    });

    expect(alert.percent).toBe(0.05);
    expect(alert.targetPrice).toBeNull();
    expect(alert.cooldownMinutes).toBe(120);
  });

  it("rejects a threshold alert carrying a percentage", () => {
    expect(() =>
      createAlert(db, {
        symbol: "BTC",
        assetClass: "crypto",
        kind: "threshold",
        direction: "above",
        targetPrice: 100_000,
        percent: 0.05,
        anchorPrice: 96_400,
        currency: "EUR",
      }),
    ).toThrow();
  });

  it("rejects a percent alert with a threshold direction", () => {
    expect(() =>
      createAlert(db, {
        symbol: "BTC",
        assetClass: "crypto",
        kind: "percent_move",
        direction: "above",
        percent: 0.05,
        anchorPrice: 96_400,
        currency: "EUR",
      }),
    ).toThrow();
  });

  it("lists only enabled alerts as armed", () => {
    const armed = createAlert(db, {
      symbol: "BTC",
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: 100_000,
      anchorPrice: 96_400,
      currency: "EUR",
    });
    const disabled = createAlert(db, {
      symbol: "AAPL",
      assetClass: "equity",
      kind: "threshold",
      direction: "below",
      targetPrice: 150,
      anchorPrice: 180,
      currency: "USD",
    });
    setAlertEnabled(db, disabled.id, false);

    expect(listAlerts(db).map((a) => a.id).sort()).toEqual(
      [armed.id, disabled.id].sort(),
    );
    expect(listArmedAlerts(db).map((a) => a.id)).toEqual([armed.id]);
    expect(getAlert(db, disabled.id)?.enabled).toBe(false);
  });

  it("records a check without touching the fire state", () => {
    const alert = createAlert(db, {
      symbol: "BTC",
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: 100_000,
      anchorPrice: 96_400,
      currency: "EUR",
    });

    recordCheck(db, alert.id, {
      checkedAt: "2026-08-21T10:00:00.000Z",
      price: 97_100,
      error: null,
    });

    const after = getAlert(db, alert.id);
    expect(after?.lastCheckedAt).toBe("2026-08-21T10:00:00.000Z");
    expect(after?.lastPrice).toBe(97_100);
    expect(after?.lastError).toBeNull();
    expect(after?.lastFiredAt).toBeNull();
  });

  it("records an error message on a check", () => {
    const alert = createAlert(db, {
      symbol: "BTC",
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: 100_000,
      anchorPrice: 96_400,
      currency: "EUR",
    });

    recordCheck(db, alert.id, {
      checkedAt: "2026-08-21T10:00:00.000Z",
      price: null,
      error: "no quote available",
    });

    expect(getAlert(db, alert.id)?.lastError).toBe("no quote available");
  });

  it("re-anchors a percent alert on fire and clears the error", () => {
    const alert = createAlert(db, {
      symbol: "ETH",
      assetClass: "crypto",
      kind: "percent_move",
      direction: "either",
      percent: 0.05,
      anchorPrice: 3_000,
      currency: "EUR",
    });
    recordCheck(db, alert.id, {
      checkedAt: "2026-08-21T09:00:00.000Z",
      price: null,
      error: "boom",
    });

    recordFire(db, alert.id, {
      firedAt: "2026-08-21T10:00:00.000Z",
      price: 3_200,
      newAnchorPrice: 3_200,
    });

    const after = getAlert(db, alert.id);
    expect(after?.lastFiredAt).toBe("2026-08-21T10:00:00.000Z");
    expect(after?.lastCheckedAt).toBe("2026-08-21T10:00:00.000Z");
    expect(after?.lastPrice).toBe(3_200);
    expect(after?.lastError).toBeNull();
    expect(after?.anchorPrice).toBe(3_200);
    expect(after?.anchorAt).toBe("2026-08-21T10:00:00.000Z");
  });

  it("leaves a threshold anchor untouched on fire", () => {
    const alert = createAlert(db, {
      symbol: "BTC",
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: 100_000,
      anchorPrice: 96_400,
      currency: "EUR",
    });

    recordFire(db, alert.id, {
      firedAt: "2026-08-21T10:00:00.000Z",
      price: 105_240,
      newAnchorPrice: null,
    });

    const after = getAlert(db, alert.id);
    expect(after?.anchorPrice).toBe(96_400);
    expect(after?.anchorAt).toBe(alert.createdAt);
  });

  it("deletes an alert", () => {
    const alert = createAlert(db, {
      symbol: "BTC",
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: 100_000,
      anchorPrice: 96_400,
      currency: "EUR",
    });

    deleteAlert(db, alert.id);

    expect(getAlert(db, alert.id)).toBeNull();
    expect(listAlerts(db)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/alerts-repo.test.ts`
Expected: FAIL — cannot resolve `@/lib/alerts/repo`.

- [ ] **Step 3: Add the table to the migration**

In `lib/db/migrate.ts`, inside the existing `db.exec(\`...\`)` template literal, immediately after the `wallet_addresses` `CREATE TABLE` and before the `CREATE UNIQUE INDEX` line, add:

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

- [ ] **Step 4: Write the types**

Create `lib/alerts/types.ts`:

```ts
import type { AssetClass } from "@/lib/quotes/types";

export type AlertKind = "threshold" | "percent_move";
export type ThresholdDirection = "above" | "below";
export type PercentDirection = "up" | "down" | "either";
export type AlertDirection = ThresholdDirection | PercentDirection;

export interface PriceAlert {
  id: string;
  symbol: string;
  assetClass: AssetClass;
  kind: AlertKind;
  direction: AlertDirection;
  /** Set for threshold alerts, null for percent alerts. */
  targetPrice: number | null;
  /** Fraction, not whole percent: 0.05 means 5%. */
  percent: number | null;
  anchorPrice: number | null;
  anchorAt: string | null;
  currency: string;
  label: string | null;
  enabled: boolean;
  cooldownMinutes: number;
  lastFiredAt: string | null;
  lastCheckedAt: string | null;
  lastPrice: number | null;
  lastError: string | null;
  createdAt: string;
}

export interface NewAlert {
  symbol: string;
  assetClass: AssetClass;
  kind: AlertKind;
  direction: AlertDirection;
  targetPrice?: number | null;
  percent?: number | null;
  /** Price at create time: the percent baseline, and the reference a message quotes. */
  anchorPrice: number;
  currency: string;
  label?: string | null;
  cooldownMinutes?: number;
}
```

- [ ] **Step 5: Write the repository**

Create `lib/alerts/repo.ts`:

```ts
import crypto from "node:crypto";
import type Database from "better-sqlite3";

import type {
  AlertDirection,
  AlertKind,
  NewAlert,
  PriceAlert,
} from "@/lib/alerts/types";
import type { AssetClass } from "@/lib/quotes/types";

const DEFAULT_COOLDOWN_MINUTES = 1440;

type AlertRow = {
  id: string;
  symbol: string;
  asset_class: AssetClass;
  kind: AlertKind;
  direction: AlertDirection;
  target_price: number | null;
  percent: number | null;
  anchor_price: number | null;
  anchor_at: string | null;
  currency: string;
  label: string | null;
  enabled: number;
  cooldown_minutes: number;
  last_fired_at: string | null;
  last_checked_at: string | null;
  last_price: number | null;
  last_error: string | null;
  created_at: string;
};

const SELECT_COLUMNS = `
  id, symbol, asset_class, kind, direction, target_price, percent,
  anchor_price, anchor_at, currency, label, enabled, cooldown_minutes,
  last_fired_at, last_checked_at, last_price, last_error, created_at
`;

function mapAlert(row: AlertRow): PriceAlert {
  return {
    id: row.id,
    symbol: row.symbol,
    assetClass: row.asset_class,
    kind: row.kind,
    direction: row.direction,
    targetPrice: row.target_price,
    percent: row.percent,
    anchorPrice: row.anchor_price,
    anchorAt: row.anchor_at,
    currency: row.currency,
    label: row.label,
    enabled: row.enabled === 1,
    cooldownMinutes: row.cooldown_minutes,
    lastFiredAt: row.last_fired_at,
    lastCheckedAt: row.last_checked_at,
    lastPrice: row.last_price,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export function createAlert(
  db: Database.Database,
  input: NewAlert,
): PriceAlert {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO price_alerts
       (id, symbol, asset_class, kind, direction, target_price, percent,
        anchor_price, anchor_at, currency, label, enabled, cooldown_minutes,
        created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    id,
    input.symbol.trim().toUpperCase(),
    input.assetClass,
    input.kind,
    input.direction,
    input.targetPrice ?? null,
    input.percent ?? null,
    input.anchorPrice,
    createdAt,
    input.currency.trim().toUpperCase(),
    input.label?.trim() || null,
    input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES,
    createdAt,
  );

  const created = getAlert(db, id);
  if (!created) throw new Error("Alert insert did not persist");
  return created;
}

export function getAlert(
  db: Database.Database,
  id: string,
): PriceAlert | null {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM price_alerts WHERE id = ?`)
    .get(id) as AlertRow | undefined;
  return row ? mapAlert(row) : null;
}

export function listAlerts(db: Database.Database): PriceAlert[] {
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM price_alerts
       ORDER BY symbol, created_at`,
    )
    .all() as AlertRow[];
  return rows.map(mapAlert);
}

export function listArmedAlerts(db: Database.Database): PriceAlert[] {
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM price_alerts
       WHERE enabled = 1
       ORDER BY symbol, created_at`,
    )
    .all() as AlertRow[];
  return rows.map(mapAlert);
}

export function setAlertEnabled(
  db: Database.Database,
  id: string,
  enabled: boolean,
): void {
  db.prepare("UPDATE price_alerts SET enabled = ? WHERE id = ?").run(
    enabled ? 1 : 0,
    id,
  );
}

export function deleteAlert(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM price_alerts WHERE id = ?").run(id);
}

export function recordCheck(
  db: Database.Database,
  id: string,
  check: { checkedAt: string; price: number | null; error: string | null },
): void {
  db.prepare(
    `UPDATE price_alerts
        SET last_checked_at = ?,
            last_price = COALESCE(?, last_price),
            last_error = ?
      WHERE id = ?`,
  ).run(check.checkedAt, check.price, check.error, id);
}

/** newAnchorPrice re-anchors a percent alert; null leaves the anchor alone. */
export function recordFire(
  db: Database.Database,
  id: string,
  fire: { firedAt: string; price: number; newAnchorPrice: number | null },
): void {
  db.prepare(
    `UPDATE price_alerts
        SET last_fired_at = ?,
            last_checked_at = ?,
            last_price = ?,
            last_error = NULL,
            anchor_price = COALESCE(?, anchor_price),
            anchor_at = COALESCE(?, anchor_at)
      WHERE id = ?`,
  ).run(
    fire.firedAt,
    fire.firedAt,
    fire.price,
    fire.newAnchorPrice,
    fire.newAnchorPrice === null ? null : fire.firedAt,
    id,
  );
}
```

- [ ] **Step 6: Add the table to the migration test**

In `tests/db-migrate.test.ts`, add `"price_alerts"` to the `expect.arrayContaining([...])` list of table names.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/alerts-repo.test.ts tests/db-migrate.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/alerts/types.ts lib/alerts/repo.ts lib/db/migrate.ts \
        tests/alerts-repo.test.ts tests/db-migrate.test.ts
git commit -m "feat: price_alerts table and repository"
```

---

### Task 2: The fire decision

**Files:**
- Create: `lib/alerts/evaluate.ts`
- Test: `tests/alerts-evaluate.test.ts`

**Interfaces:**
- Consumes: `PriceAlert` from `@/lib/alerts/types`, `Quote` from `@/lib/quotes/types`.
- Produces: `evaluateAlert(alert: PriceAlert, quote: Quote, now: Date): AlertDecision`, where `AlertDecision` is `{ fires: boolean; code: AlertDecisionCode; detail: string | null; nextAnchorPrice: number | null }` and `AlertDecisionCode` is `"fired" | "cooldown" | "not-crossed" | "stale-quote" | "currency-mismatch" | "missing-anchor"`. `detail` is the string `run.ts` writes to `last_error`; it is `null` for `fired`, `cooldown`, and `not-crossed`.

- [ ] **Step 1: Write the failing test**

Create `tests/alerts-evaluate.test.ts`:

```tsx
import { describe, expect, it } from "vitest";

import { evaluateAlert } from "@/lib/alerts/evaluate";
import type { PriceAlert } from "@/lib/alerts/types";
import type { Quote } from "@/lib/quotes/types";

const NOW = new Date("2026-08-21T12:00:00.000Z");

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: "alert-1",
    symbol: "BTC",
    assetClass: "crypto",
    kind: "threshold",
    direction: "above",
    targetPrice: 100_000,
    percent: null,
    anchorPrice: 96_400,
    anchorAt: "2026-08-01T00:00:00.000Z",
    currency: "EUR",
    label: null,
    enabled: true,
    cooldownMinutes: 1440,
    lastFiredAt: null,
    lastCheckedAt: null,
    lastPrice: null,
    lastError: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function quote(price: number, overrides: Partial<Quote> = {}): Quote {
  return {
    price,
    currency: "EUR",
    stale: false,
    fetchedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("evaluateAlert", () => {
  it("fires an above-threshold alert at or past the level", () => {
    expect(evaluateAlert(alert(), quote(100_000), NOW)).toEqual({
      fires: true,
      code: "fired",
      detail: null,
      nextAnchorPrice: null,
    });
    expect(evaluateAlert(alert(), quote(105_240), NOW).fires).toBe(true);
  });

  it("does not fire an above-threshold alert below the level", () => {
    expect(evaluateAlert(alert(), quote(99_999), NOW)).toEqual({
      fires: false,
      code: "not-crossed",
      detail: null,
      nextAnchorPrice: null,
    });
  });

  it("fires a below-threshold alert at or under the level", () => {
    const below = alert({ direction: "below", targetPrice: 90_000 });
    expect(evaluateAlert(below, quote(90_000), NOW).fires).toBe(true);
    expect(evaluateAlert(below, quote(89_000), NOW).fires).toBe(true);
    expect(evaluateAlert(below, quote(90_001), NOW).fires).toBe(false);
  });

  it("suppresses a crossed alert inside the cooldown window", () => {
    const cooling = alert({
      cooldownMinutes: 60,
      lastFiredAt: "2026-08-21T11:30:00.000Z",
    });
    expect(evaluateAlert(cooling, quote(105_240), NOW)).toEqual({
      fires: false,
      code: "cooldown",
      detail: null,
      nextAnchorPrice: null,
    });
  });

  it("fires again once the cooldown has elapsed", () => {
    const cooled = alert({
      cooldownMinutes: 60,
      lastFiredAt: "2026-08-21T10:59:00.000Z",
    });
    expect(evaluateAlert(cooled, quote(105_240), NOW).fires).toBe(true);
  });

  it("never fires on a stale quote, even when crossed", () => {
    const decision = evaluateAlert(
      alert(),
      quote(105_240, { stale: true }),
      NOW,
    );
    expect(decision.fires).toBe(false);
    expect(decision.code).toBe("stale-quote");
    expect(decision.detail).toContain("stale");
  });

  it("reports a currency mismatch instead of comparing", () => {
    const decision = evaluateAlert(
      alert(),
      quote(105_240, { currency: "USD" }),
      NOW,
    );
    expect(decision.fires).toBe(false);
    expect(decision.code).toBe("currency-mismatch");
    expect(decision.detail).toContain("USD");
    expect(decision.detail).toContain("EUR");
  });

  it("fires an either-direction percent alert on a move up or down", () => {
    const move = alert({
      kind: "percent_move",
      direction: "either",
      targetPrice: null,
      percent: 0.05,
      anchorPrice: 100_000,
    });

    expect(evaluateAlert(move, quote(105_000), NOW)).toEqual({
      fires: true,
      code: "fired",
      detail: null,
      nextAnchorPrice: 105_000,
    });
    expect(evaluateAlert(move, quote(95_000), NOW).fires).toBe(true);
    expect(evaluateAlert(move, quote(104_000), NOW).code).toBe("not-crossed");
  });

  it("respects percent direction", () => {
    const up = alert({
      kind: "percent_move",
      direction: "up",
      targetPrice: null,
      percent: 0.05,
      anchorPrice: 100_000,
    });
    expect(evaluateAlert(up, quote(106_000), NOW).fires).toBe(true);
    expect(evaluateAlert(up, quote(94_000), NOW).fires).toBe(false);

    const down = alert({
      kind: "percent_move",
      direction: "down",
      targetPrice: null,
      percent: 0.05,
      anchorPrice: 100_000,
    });
    expect(evaluateAlert(down, quote(94_000), NOW).fires).toBe(true);
    expect(evaluateAlert(down, quote(106_000), NOW).fires).toBe(false);
  });

  it("reports a missing anchor rather than dividing by zero", () => {
    const broken = alert({
      kind: "percent_move",
      direction: "either",
      targetPrice: null,
      percent: 0.05,
      anchorPrice: 0,
    });
    const decision = evaluateAlert(broken, quote(105_000), NOW);
    expect(decision.fires).toBe(false);
    expect(decision.code).toBe("missing-anchor");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/alerts-evaluate.test.ts`
Expected: FAIL — cannot resolve `@/lib/alerts/evaluate`.

- [ ] **Step 3: Write the implementation**

Create `lib/alerts/evaluate.ts`:

```ts
import type { PriceAlert } from "@/lib/alerts/types";
import type { Quote } from "@/lib/quotes/types";

export type AlertDecisionCode =
  | "fired"
  | "cooldown"
  | "not-crossed"
  | "stale-quote"
  | "currency-mismatch"
  | "missing-anchor";

export interface AlertDecision {
  fires: boolean;
  code: AlertDecisionCode;
  /** Text for last_error. Null when nothing went wrong. */
  detail: string | null;
  /** Re-anchor target for percent alerts; null leaves the anchor alone. */
  nextAnchorPrice: number | null;
}

function decision(
  code: AlertDecisionCode,
  detail: string | null = null,
): AlertDecision {
  return { fires: false, code, detail, nextAnchorPrice: null };
}

function inCooldown(alert: PriceAlert, now: Date): boolean {
  if (!alert.lastFiredAt) return false;
  const elapsedMs = now.getTime() - new Date(alert.lastFiredAt).getTime();
  return elapsedMs < alert.cooldownMinutes * 60_000;
}

export function evaluateAlert(
  alert: PriceAlert,
  quote: Quote,
  now: Date,
): AlertDecision {
  // A stale quote means the provider failed and the service served cache.
  // A stale price crossing a level is not news.
  if (quote.stale) {
    return decision(
      "stale-quote",
      `Quote for ${alert.symbol} is stale (fetched ${quote.fetchedAt})`,
    );
  }

  const quoteCurrency = quote.currency.trim().toUpperCase();
  if (quoteCurrency !== alert.currency) {
    return decision(
      "currency-mismatch",
      `Quote currency ${quoteCurrency} does not match alert currency ${alert.currency}`,
    );
  }

  if (inCooldown(alert, now)) {
    return decision("cooldown");
  }

  if (alert.kind === "threshold") {
    const target = alert.targetPrice;
    if (target == null) {
      return decision("missing-anchor", "Threshold alert has no target price");
    }
    const crossed =
      alert.direction === "above" ? quote.price >= target : quote.price <= target;
    return crossed
      ? { fires: true, code: "fired", detail: null, nextAnchorPrice: null }
      : decision("not-crossed");
  }

  const anchor = alert.anchorPrice;
  if (anchor == null || anchor === 0) {
    return decision(
      "missing-anchor",
      `Percent alert for ${alert.symbol} has no usable anchor price`,
    );
  }

  const percent = alert.percent;
  if (percent == null) {
    return decision("missing-anchor", "Percent alert has no percentage");
  }

  const move = (quote.price - anchor) / anchor;
  const bigEnough = Math.abs(move) >= percent;
  const directionMatches =
    alert.direction === "either" ||
    (alert.direction === "up" && move > 0) ||
    (alert.direction === "down" && move < 0);

  if (!bigEnough || !directionMatches) {
    return decision("not-crossed");
  }

  return {
    fires: true,
    code: "fired",
    detail: null,
    nextAnchorPrice: quote.price,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/alerts-evaluate.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/alerts/evaluate.ts tests/alerts-evaluate.test.ts
git commit -m "feat: pure alert fire decision with cooldown and stale-quote guards"
```

---

### Task 3: Telegram delivery

**Files:**
- Create: `lib/alerts/telegram.ts`
- Test: `tests/alerts-telegram.test.ts`

**Interfaces:**
- Consumes: `PriceAlert` from `@/lib/alerts/types`, `formatMoney` from `@/lib/format-money`.
- Produces: `AlertNotifier` (`{ send(text: string): Promise<void> }`), `TelegramConfig` (`{ botToken: string; chatId: string }`), `telegramConfigFromEnv(env?): TelegramConfig | null`, `createTelegramNotifier(config, fetchImpl): AlertNotifier`, `formatAlertMessage(alert: PriceAlert, price: number): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/alerts-telegram.test.ts`:

```tsx
import { describe, expect, it, vi } from "vitest";

import {
  createTelegramNotifier,
  formatAlertMessage,
  telegramConfigFromEnv,
} from "@/lib/alerts/telegram";
import type { PriceAlert } from "@/lib/alerts/types";

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: "alert-1",
    symbol: "BTC",
    assetClass: "crypto",
    kind: "threshold",
    direction: "above",
    targetPrice: 100_000,
    percent: null,
    anchorPrice: 96_400,
    anchorAt: "2026-08-01T00:00:00.000Z",
    currency: "EUR",
    label: null,
    enabled: true,
    cooldownMinutes: 1440,
    lastFiredAt: null,
    lastCheckedAt: null,
    lastPrice: null,
    lastError: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("telegramConfigFromEnv", () => {
  it("returns null when either variable is missing", () => {
    expect(telegramConfigFromEnv({})).toBeNull();
    expect(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: "t" })).toBeNull();
    expect(telegramConfigFromEnv({ TELEGRAM_CHAT_ID: "1" })).toBeNull();
    expect(
      telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: "  ", TELEGRAM_CHAT_ID: "1" }),
    ).toBeNull();
  });

  it("returns a trimmed config when both are set", () => {
    expect(
      telegramConfigFromEnv({
        TELEGRAM_BOT_TOKEN: " 123:abc ",
        TELEGRAM_CHAT_ID: " 4242 ",
      }),
    ).toEqual({ botToken: "123:abc", chatId: "4242" });
  });
});

describe("createTelegramNotifier", () => {
  it("posts the message to the bot sendMessage endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const notifier = createTelegramNotifier(
      { botToken: "123:abc", chatId: "4242" },
      fetchImpl as unknown as typeof fetch,
    );

    await notifier.send("hello");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: "4242",
      text: "hello",
      disable_web_page_preview: true,
    });
  });

  it("throws on a non-2xx response so the caller can retry", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 429 }),
    );
    const notifier = createTelegramNotifier(
      { botToken: "123:abc", chatId: "4242" },
      fetchImpl as unknown as typeof fetch,
    );

    await expect(notifier.send("hello")).rejects.toThrow("429");
  });
});

describe("formatAlertMessage", () => {
  it("describes a crossed threshold and quotes the create-time price", () => {
    const text = formatAlertMessage(alert(), 105_240);
    expect(text).toContain("BTC");
    expect(text).toContain("crossed above");
    expect(text).toContain("€100,000.00");
    expect(text).toContain("€105,240.00");
    expect(text).toContain("€96,400.00");
  });

  it("describes a percent move with sign and baseline", () => {
    const text = formatAlertMessage(
      alert({
        kind: "percent_move",
        direction: "either",
        targetPrice: null,
        percent: 0.05,
        anchorPrice: 100_000,
      }),
      94_000,
    );
    expect(text).toContain("−6.00%");
    expect(text).toContain("€100,000.00");
    expect(text).toContain("€94,000.00");
  });

  it("includes the label when one is set", () => {
    expect(formatAlertMessage(alert({ label: "take profit" }), 105_240)).toContain(
      "take profit",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/alerts-telegram.test.ts`
Expected: FAIL — cannot resolve `@/lib/alerts/telegram`.

- [ ] **Step 3: Write the implementation**

Create `lib/alerts/telegram.ts`:

```ts
import type { PriceAlert } from "@/lib/alerts/types";
import { formatMoney } from "@/lib/format-money";

export interface AlertNotifier {
  send(text: string): Promise<void>;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export function telegramConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): TelegramConfig | null {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

export function createTelegramNotifier(
  config: TelegramConfig,
  fetchImpl: typeof fetch,
): AlertNotifier {
  return {
    async send(text: string): Promise<void> {
      const response = await fetchImpl(
        `https://api.telegram.org/bot${config.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: config.chatId,
            text,
            disable_web_page_preview: true,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Telegram sendMessage failed (${response.status})`);
      }
    },
  };
}

function formatPercent(move: number): string {
  const sign = move >= 0 ? "+" : "−";
  return `${sign}${(Math.abs(move) * 100).toFixed(2)}%`;
}

export function formatAlertMessage(alert: PriceAlert, price: number): string {
  const now = formatMoney(price, alert.currency);
  const lines: string[] = [];

  if (alert.kind === "threshold" && alert.targetPrice != null) {
    const target = formatMoney(alert.targetPrice, alert.currency);
    lines.push(`🔔 ${alert.symbol} ${now} — crossed ${alert.direction} ${target}`);
    if (alert.anchorPrice != null) {
      lines.push(
        `was ${formatMoney(alert.anchorPrice, alert.currency)} when you set this`,
      );
    }
  } else if (alert.anchorPrice != null && alert.anchorPrice !== 0) {
    const move = (price - alert.anchorPrice) / alert.anchorPrice;
    lines.push(
      `🔔 ${alert.symbol} ${now} — ${formatPercent(move)} from ` +
        `${formatMoney(alert.anchorPrice, alert.currency)}`,
    );
  } else {
    lines.push(`🔔 ${alert.symbol} ${now}`);
  }

  if (alert.label) lines.push(alert.label);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/alerts-telegram.test.ts`
Expected: PASS, 7 tests. If a `formatMoney` assertion fails, read the actual output and fix the **test's expected string** to match `formatMoney` — that helper is the app-wide formatter and must not be changed here.

- [ ] **Step 5: Commit**

```bash
git add lib/alerts/telegram.ts tests/alerts-telegram.test.ts
git commit -m "feat: telegram notifier and alert message formatting"
```

---

### Task 4: The evaluation pass

**Files:**
- Create: `lib/alerts/run.ts`
- Test: `tests/alerts-run.test.ts`

**Interfaces:**
- Consumes: `listArmedAlerts`, `recordCheck`, `recordFire` from `@/lib/alerts/repo`; `evaluateAlert` from `@/lib/alerts/evaluate`; `AlertNotifier`, `formatAlertMessage`, `telegramConfigFromEnv`, `createTelegramNotifier` from `@/lib/alerts/telegram`; `QuoteService`, `Quote` from `@/lib/quotes/types`; `createQuoteService` from `@/lib/quotes/service`; `getDb` from `@/lib/db/client`.
- Produces: `runAlerts(opts: { db; quotes; notifier; now? }): Promise<RunAlertsResult>` and `runAlertsNow(): Promise<RunAlertsResult>`, where `RunAlertsResult` is `{ checked: number; fired: number; errors: number; skipped?: "telegram-not-configured" }`.

- [ ] **Step 1: Write the failing test**

Create `tests/alerts-run.test.ts`:

```tsx
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAlert, getAlert, setAlertEnabled } from "@/lib/alerts/repo";
import { runAlerts } from "@/lib/alerts/run";
import type { AlertNotifier } from "@/lib/alerts/telegram";
import { migrate } from "@/lib/db/migrate";
import type { Quote, QuoteService } from "@/lib/quotes/types";

const NOW = new Date("2026-08-21T12:00:00.000Z");

function fresh(price: number, currency = "EUR"): Quote {
  return { price, currency, stale: false, fetchedAt: NOW.toISOString() };
}

/** Quote service backed by a fixed map; records how it was called. */
function fakeQuotes(prices: Record<string, Quote>) {
  const cryptoCalls: string[][] = [];
  const equityCalls: string[] = [];
  const service: QuoteService = {
    async getQuote(symbol) {
      equityCalls.push(symbol);
      const quote = prices[symbol];
      if (!quote) throw new Error(`no quote for ${symbol}`);
      return quote;
    },
    async getCryptoQuotes(symbols) {
      cryptoCalls.push(symbols);
      const map = new Map<string, Quote>();
      for (const symbol of symbols) {
        const quote = prices[symbol];
        if (quote) map.set(symbol, quote);
      }
      return map;
    },
    async getFxRate() {
      return { rate: 1, stale: false };
    },
  };
  return { service, cryptoCalls, equityCalls };
}

function fakeNotifier(): AlertNotifier & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    async send(text: string) {
      sent.push(text);
    },
  };
}

describe("runAlerts", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  function thresholdAlert(symbol: string, target: number) {
    return createAlert(db, {
      symbol,
      assetClass: "crypto",
      kind: "threshold",
      direction: "above",
      targetPrice: target,
      anchorPrice: target * 0.9,
      currency: "EUR",
    });
  }

  it("skips the pass entirely when there is no notifier", async () => {
    thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({ BTC: fresh(105_000) });

    const result = await runAlerts({
      db,
      quotes: service,
      notifier: null,
      now: NOW,
    });

    expect(result).toEqual({
      checked: 0,
      fired: 0,
      errors: 0,
      skipped: "telegram-not-configured",
    });
  });

  it("sends one message per fired alert and records the fire", async () => {
    const alert = thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({ BTC: fresh(105_240) });
    const notifier = fakeNotifier();

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    expect(result).toEqual({ checked: 1, fired: 1, errors: 0 });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toContain("BTC");
    const after = getAlert(db, alert.id);
    expect(after?.lastFiredAt).toBe(NOW.toISOString());
    expect(after?.lastPrice).toBe(105_240);
  });

  it("batches every crypto symbol into a single quote call", async () => {
    thresholdAlert("BTC", 100_000);
    thresholdAlert("ETH", 5_000);
    thresholdAlert("BTC", 200_000);
    const { service, cryptoCalls } = fakeQuotes({
      BTC: fresh(105_240),
      ETH: fresh(3_000),
    });

    await runAlerts({ db, quotes: service, notifier: fakeNotifier(), now: NOW });

    expect(cryptoCalls).toHaveLength(1);
    expect([...cryptoCalls[0]].sort()).toEqual(["BTC", "ETH"]);
  });

  it("records a check without firing when the level is not crossed", async () => {
    const alert = thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({ BTC: fresh(97_000) });
    const notifier = fakeNotifier();

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    expect(result).toEqual({ checked: 1, fired: 0, errors: 0 });
    expect(notifier.sent).toEqual([]);
    const after = getAlert(db, alert.id);
    expect(after?.lastCheckedAt).toBe(NOW.toISOString());
    expect(after?.lastFiredAt).toBeNull();
    expect(after?.lastError).toBeNull();
  });

  it("leaves the alert unfired and retryable when the send throws", async () => {
    const alert = thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({ BTC: fresh(105_240) });
    const notifier: AlertNotifier = {
      send: vi.fn(async () => {
        throw new Error("telegram down");
      }),
    };

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    expect(result).toEqual({ checked: 1, fired: 0, errors: 1 });
    const after = getAlert(db, alert.id);
    expect(after?.lastFiredAt).toBeNull();
    expect(after?.lastError).toContain("telegram down");
  });

  it("records an error when no quote comes back", async () => {
    const alert = thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({});

    const result = await runAlerts({
      db,
      quotes: service,
      notifier: fakeNotifier(),
      now: NOW,
    });

    expect(result).toEqual({ checked: 1, fired: 0, errors: 1 });
    const after = getAlert(db, alert.id);
    expect(after?.lastError).toContain("quote");
    expect(after?.enabled).toBe(true);
  });

  it("records an error for a stale quote instead of firing", async () => {
    const alert = thresholdAlert("BTC", 100_000);
    const { service } = fakeQuotes({
      BTC: { ...fresh(105_240), stale: true },
    });
    const notifier = fakeNotifier();

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    expect(result).toEqual({ checked: 1, fired: 0, errors: 1 });
    expect(notifier.sent).toEqual([]);
    expect(getAlert(db, alert.id)?.lastError).toContain("stale");
  });

  it("ignores disabled alerts and prices equities per alert currency", async () => {
    createAlert(db, {
      symbol: "AAPL",
      assetClass: "equity",
      kind: "threshold",
      direction: "below",
      targetPrice: 150,
      anchorPrice: 180,
      currency: "EUR",
    });
    const disabled = thresholdAlert("BTC", 1);
    setAlertEnabled(db, disabled.id, false);

    const { service, equityCalls, cryptoCalls } = fakeQuotes({
      AAPL: fresh(140),
      BTC: fresh(105_240),
    });
    const notifier = fakeNotifier();

    const result = await runAlerts({ db, quotes: service, notifier, now: NOW });

    // The disabled BTC alert is never priced and never sends.
    expect(equityCalls).toEqual(["AAPL"]);
    expect(cryptoCalls).toEqual([]);
    expect(result.checked).toBe(1);
    expect(result.fired).toBe(1);
    expect(notifier.sent).toHaveLength(1);
    expect(getAlert(db, disabled.id)?.lastCheckedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/alerts-run.test.ts`
Expected: FAIL — cannot resolve `@/lib/alerts/run`.

- [ ] **Step 3: Write the implementation**

Create `lib/alerts/run.ts`:

```ts
import "server-only";

import type Database from "better-sqlite3";

import { evaluateAlert } from "@/lib/alerts/evaluate";
import { listArmedAlerts, recordCheck, recordFire } from "@/lib/alerts/repo";
import {
  createTelegramNotifier,
  formatAlertMessage,
  telegramConfigFromEnv,
  type AlertNotifier,
} from "@/lib/alerts/telegram";
import type { PriceAlert } from "@/lib/alerts/types";
import { getDb } from "@/lib/db/client";
import { createQuoteService } from "@/lib/quotes/service";
import type { Quote, QuoteService } from "@/lib/quotes/types";

export interface RunAlertsResult {
  checked: number;
  fired: number;
  errors: number;
  skipped?: "telegram-not-configured";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Quotes for every armed alert. Crypto goes out as one batched request;
 * equities are one request per symbol+currency pair, memoised so duplicate
 * alerts on the same symbol do not re-fetch.
 */
async function loadQuotes(
  alerts: PriceAlert[],
  quotes: QuoteService,
): Promise<Map<string, Quote>> {
  const byKey = new Map<string, Quote>();

  const cryptoSymbols = [
    ...new Set(
      alerts.filter((a) => a.assetClass === "crypto").map((a) => a.symbol),
    ),
  ];
  if (cryptoSymbols.length > 0) {
    try {
      const fetched = await quotes.getCryptoQuotes(cryptoSymbols);
      for (const [symbol, quote] of fetched) {
        byKey.set(`crypto|${symbol}`, quote);
      }
    } catch {
      // Leave them missing; each alert records "no quote available".
    }
  }

  for (const alert of alerts) {
    if (alert.assetClass !== "equity") continue;
    const key = `equity|${alert.symbol}|${alert.currency}`;
    if (byKey.has(key)) continue;
    try {
      byKey.set(
        key,
        await quotes.getQuote(alert.symbol, "equity", {
          preferredCurrency: alert.currency,
        }),
      );
    } catch {
      // Same as above.
    }
  }

  return byKey;
}

function quoteKey(alert: PriceAlert): string {
  return alert.assetClass === "crypto"
    ? `crypto|${alert.symbol}`
    : `equity|${alert.symbol}|${alert.currency}`;
}

export async function runAlerts(opts: {
  db: Database.Database;
  quotes: QuoteService;
  notifier: AlertNotifier | null;
  now?: Date;
}): Promise<RunAlertsResult> {
  if (!opts.notifier) {
    return {
      checked: 0,
      fired: 0,
      errors: 0,
      skipped: "telegram-not-configured",
    };
  }

  const now = opts.now ?? new Date();
  const checkedAt = now.toISOString();
  const alerts = listArmedAlerts(opts.db);
  if (alerts.length === 0) return { checked: 0, fired: 0, errors: 0 };

  const quotes = await loadQuotes(alerts, opts.quotes);
  let fired = 0;
  let errors = 0;

  for (const alert of alerts) {
    const quote = quotes.get(quoteKey(alert));
    if (!quote) {
      errors += 1;
      recordCheck(opts.db, alert.id, {
        checkedAt,
        price: null,
        error: `No quote available for ${alert.symbol}`,
      });
      continue;
    }

    const decision = evaluateAlert(alert, quote, now);

    if (!decision.fires) {
      if (decision.detail) errors += 1;
      recordCheck(opts.db, alert.id, {
        checkedAt,
        price: quote.price,
        error: decision.detail,
      });
      continue;
    }

    try {
      await opts.notifier.send(formatAlertMessage(alert, quote.price));
    } catch (error) {
      // Do not mark it fired: the next pass retries, so cooldown starts from
      // a message that actually arrived.
      errors += 1;
      recordCheck(opts.db, alert.id, {
        checkedAt,
        price: quote.price,
        error: `Send failed: ${errorMessage(error)}`,
      });
      continue;
    }

    fired += 1;
    recordFire(opts.db, alert.id, {
      firedAt: checkedAt,
      price: quote.price,
      newAnchorPrice: decision.nextAnchorPrice,
    });
  }

  return { checked: alerts.length, fired, errors };
}

/** Wired to the real database, quote service, and env-configured bot. */
export async function runAlertsNow(): Promise<RunAlertsResult> {
  const db = getDb();
  const config = telegramConfigFromEnv();
  return runAlerts({
    db,
    quotes: createQuoteService(db, globalThis.fetch),
    notifier: config
      ? createTelegramNotifier(config, globalThis.fetch)
      : null,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/alerts-run.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/alerts/run.ts tests/alerts-run.test.ts
git commit -m "feat: alert evaluation pass with batched quotes and retryable sends"
```

---

### Task 5: Scheduler, run route, and deployment config

**Files:**
- Create: `lib/alerts/scheduler.ts`
- Create: `instrumentation.ts` (repository root, next to `next.config.ts`)
- Create: `app/api/alerts/run/route.ts`
- Test: `tests/alerts-scheduler.test.ts`
- Modify: `.env.example`
- Modify: `deploy/pi/run-container.sh:60-72` (the `docker run` argument list)
- Modify: `deploy/pi/bootstrap.sh:30` (after the `install -d` lines)
- Modify: `README.md` (Raspberry Pi section)

**Interfaces:**
- Consumes: `runAlertsNow` from `@/lib/alerts/run`.
- Produces: `alertsSchedulerEnabled(env?): boolean`, `alertsIntervalMs(env?): number`, `startAlertScheduler(): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/alerts-scheduler.test.ts`:

```tsx
import { describe, expect, it } from "vitest";

import {
  alertsIntervalMs,
  alertsSchedulerEnabled,
} from "@/lib/alerts/scheduler";

describe("alertsSchedulerEnabled", () => {
  it("runs in production by default", () => {
    expect(alertsSchedulerEnabled({ NODE_ENV: "production" })).toBe(true);
  });

  it("stays off in development unless opted in", () => {
    expect(alertsSchedulerEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(
      alertsSchedulerEnabled({ NODE_ENV: "development", ALERTS_ENABLED: "1" }),
    ).toBe(true);
  });

  it("can be switched off in production", () => {
    expect(
      alertsSchedulerEnabled({ NODE_ENV: "production", ALERTS_ENABLED: "0" }),
    ).toBe(false);
  });
});

describe("alertsIntervalMs", () => {
  it("defaults to ten minutes", () => {
    expect(alertsIntervalMs({})).toBe(600_000);
  });

  it("honours a valid override", () => {
    expect(alertsIntervalMs({ ALERTS_INTERVAL_MS: "120000" })).toBe(120_000);
  });

  it("ignores junk and sub-minute values", () => {
    expect(alertsIntervalMs({ ALERTS_INTERVAL_MS: "abc" })).toBe(600_000);
    expect(alertsIntervalMs({ ALERTS_INTERVAL_MS: "1000" })).toBe(600_000);
    expect(alertsIntervalMs({ ALERTS_INTERVAL_MS: "-5" })).toBe(600_000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/alerts-scheduler.test.ts`
Expected: FAIL — cannot resolve `@/lib/alerts/scheduler`.

- [ ] **Step 3: Write the scheduler**

Create `lib/alerts/scheduler.ts`:

```ts
import "server-only";

import { runAlertsNow } from "@/lib/alerts/run";

const DEFAULT_INTERVAL_MS = 600_000;
const MIN_INTERVAL_MS = 60_000;
/** Let the server finish booting before the first pass. */
const FIRST_PASS_DELAY_MS = 30_000;

let started = false;

export function alertsSchedulerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.ALERTS_ENABLED === "1") return true;
  if (env.ALERTS_ENABLED === "0") return false;
  return env.NODE_ENV === "production";
}

export function alertsIntervalMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.ALERTS_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw < MIN_INTERVAL_MS) {
    return DEFAULT_INTERVAL_MS;
  }
  return raw;
}

async function tick(): Promise<void> {
  try {
    const result = await runAlertsNow();
    if (result.skipped) {
      console.log(`[alerts] skipped: ${result.skipped}`);
      return;
    }
    console.log(
      `[alerts] checked ${result.checked}, fired ${result.fired}, errors ${result.errors}`,
    );
  } catch (error) {
    console.error("[alerts] pass failed", error);
  }
}

/** Idempotent: a hot reload cannot stack intervals. */
export function startAlertScheduler(): void {
  if (started || !alertsSchedulerEnabled()) return;
  started = true;

  const intervalMs = alertsIntervalMs();
  console.log(`[alerts] scheduler on, every ${intervalMs / 1000}s`);

  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), intervalMs);
  }, FIRST_PASS_DELAY_MS);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/alerts-scheduler.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the instrumentation hook and the run route**

Create `instrumentation.ts` at the repository root:

```ts
/**
 * Next runs this once per server process. The edge runtime has no SQLite, so
 * only the Node runtime starts the alert scheduler.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startAlertScheduler } = await import("@/lib/alerts/scheduler");
  startAlertScheduler();
}
```

Create `app/api/alerts/run/route.ts`:

```ts
import { NextResponse } from "next/server";

import { runAlertsNow } from "@/lib/alerts/run";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await runAlertsNow();
  return NextResponse.json(result);
}
```

- [ ] **Step 6: Verify the hook loads and the route answers**

Run: `ALERTS_ENABLED=1 ALERTS_INTERVAL_MS=60000 npm run dev`
Expected: the log line `[alerts] scheduler on, every 60s` appears at startup. Then in another shell:

Run: `curl -s -X POST http://localhost:3000/api/alerts/run`
Expected: JSON. With no bot token configured:
`{"checked":0,"fired":0,"errors":0,"skipped":"telegram-not-configured"}`

Stop the dev server afterwards.

- [ ] **Step 7: Document the configuration**

Append to `.env.example`:

```
# Telegram price alerts (both required to send)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
# optional — evaluation interval, default 600000 (10 min), floor 60000
ALERTS_INTERVAL_MS=
# optional — 1 forces the scheduler on in dev, 0 forces it off in production
ALERTS_ENABLED=
```

- [ ] **Step 8: Pass the token into the Pi container**

In `deploy/pi/run-container.sh`, immediately before the `exec docker run` line, add:

```bash
# Secrets live outside releases/ so a deploy never overwrites them.
ENV_FILE_ARGS=()
if [[ -f "$ROOT/portfolio.env" ]]; then
  ENV_FILE_ARGS=(--env-file "$ROOT/portfolio.env")
fi
```

Then add `"${ENV_FILE_ARGS[@]}"` to the `docker run` argument list, on its own
continuation line directly after `--env DATABASE_PATH=/data/portfolio.db \`:

```bash
  "${ENV_FILE_ARGS[@]}" \
```

In `deploy/pi/bootstrap.sh`, after the existing `install -d` lines, add:

```bash
# Template for secrets (Telegram bot token). Not overwritten if it exists.
if [[ ! -f /opt/portfolio/portfolio.env ]]; then
  cat > /opt/portfolio/portfolio.env <<'EOF'
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=
EOF
  chown pi:pi /opt/portfolio/portfolio.env
  chmod 0600 /opt/portfolio/portfolio.env
fi
```

In `README.md`, add to the Raspberry Pi section:

```markdown
### Price alerts

Alerts are evaluated in-process every 10 minutes and delivered by a Telegram
bot. Create one with [@BotFather](https://t.me/botfather), message it once, and
read your chat id from
`https://api.telegram.org/bot<token>/getUpdates`. Then on the Pi:

```bash
sudo -u pi tee /opt/portfolio/portfolio.env >/dev/null <<'EOF'
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=42424242
EOF
sudo chmod 0600 /opt/portfolio/portfolio.env
sudo systemctl restart portfolio
```

The file lives outside `releases/`, so deploys never overwrite it. Without
both variables the scheduler runs and reports `telegram-not-configured`
without sending anything.
```

- [ ] **Step 9: Check the shell edits parse**

Run: `bash -n deploy/pi/run-container.sh && bash -n deploy/pi/bootstrap.sh`
Expected: no output (both parse).

- [ ] **Step 10: Commit**

```bash
git add lib/alerts/scheduler.ts instrumentation.ts app/api/alerts/run/route.ts \
        tests/alerts-scheduler.test.ts .env.example README.md \
        deploy/pi/run-container.sh deploy/pi/bootstrap.sh
git commit -m "feat: 10-minute alert scheduler, manual run route, Pi secret file"
```

---

### Task 6: Symbol validation and server actions

**Files:**
- Create: `lib/alerts/resolve-symbol.ts`
- Create: `app/actions/alerts.ts`
- Test: `tests/alerts-resolve-symbol.test.ts`

**Interfaces:**
- Consumes: `coingeckoIdForSymbol` from `@/lib/quotes/crypto-coingecko`; `QuoteService`; `createAlert`, `deleteAlert`, `setAlertEnabled` from `@/lib/alerts/repo`; `getSettings` from `@/lib/settings`; `runAlertsNow` from `@/lib/alerts/run`; `telegramConfigFromEnv`, `createTelegramNotifier` from `@/lib/alerts/telegram`.
- Produces: `resolveAlertSymbol(symbol, assetClass, baseCurrency, quotes): Promise<{ symbol: string; price: number; currency: string }>`; server actions `createAlertAction(input: CreateAlertInput): Promise<ActionResult>`, `deleteAlertAction(id: string): Promise<void>`, `toggleAlertAction(id: string, enabled: boolean): Promise<void>`, `runAlertsNowAction(): Promise<RunAlertsResult>`, `sendTestMessageAction(): Promise<ActionResult>`. `ActionResult` is `{ ok: true } | { ok: false; error: string }`. `CreateAlertInput` is `{ symbol: string; assetClass: AssetClass; kind: AlertKind; direction: AlertDirection; targetPrice?: number; percentWhole?: number; cooldownMinutes?: number; label?: string }` — note `percentWhole` is what the user typed (5 for 5%); the action divides by 100.

- [ ] **Step 1: Write the failing test**

Create `tests/alerts-resolve-symbol.test.ts`:

```tsx
import { describe, expect, it } from "vitest";

import { resolveAlertSymbol } from "@/lib/alerts/resolve-symbol";
import type { Quote, QuoteService } from "@/lib/quotes/types";

function quotes(prices: Record<string, Quote>): QuoteService {
  return {
    async getQuote(symbol) {
      const quote = prices[symbol];
      if (!quote) throw new Error(`Yahoo request failed (404)`);
      return quote;
    },
    async getCryptoQuotes(symbols) {
      const map = new Map<string, Quote>();
      for (const symbol of symbols) {
        const quote = prices[symbol];
        if (quote) map.set(symbol, quote);
      }
      return map;
    },
    async getFxRate() {
      return { rate: 1, stale: false };
    },
  };
}

const fresh = (price: number, currency = "EUR"): Quote => ({
  price,
  currency,
  stale: false,
  fetchedAt: "2026-08-21T12:00:00.000Z",
});

describe("resolveAlertSymbol", () => {
  it("resolves a mapped crypto symbol and upper-cases it", async () => {
    const resolved = await resolveAlertSymbol(
      " btc ",
      "crypto",
      "EUR",
      quotes({ BTC: fresh(96_400) }),
    );
    expect(resolved).toEqual({
      symbol: "BTC",
      price: 96_400,
      currency: "EUR",
    });
  });

  it("rejects a crypto symbol missing from the CoinGecko map", async () => {
    await expect(
      resolveAlertSymbol("XYZ", "crypto", "EUR", quotes({})),
    ).rejects.toThrow(/COINGECKO_IDS/);
  });

  it("rejects a mapped crypto symbol with no price available", async () => {
    await expect(
      resolveAlertSymbol("SOL", "crypto", "EUR", quotes({})),
    ).rejects.toThrow(/price/i);
  });

  it("resolves an equity through the quote service and keeps its currency", async () => {
    const resolved = await resolveAlertSymbol(
      "aapl",
      "equity",
      "EUR",
      quotes({ AAPL: fresh(180, "USD") }),
    );
    expect(resolved).toEqual({ symbol: "AAPL", price: 180, currency: "USD" });
  });

  it("surfaces the provider error for an unknown ticker", async () => {
    await expect(
      resolveAlertSymbol("NOPE", "equity", "EUR", quotes({})),
    ).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/alerts-resolve-symbol.test.ts`
Expected: FAIL — cannot resolve `@/lib/alerts/resolve-symbol`.

- [ ] **Step 3: Write the resolver**

Create `lib/alerts/resolve-symbol.ts`:

```ts
import { coingeckoIdForSymbol } from "@/lib/quotes/crypto-coingecko";
import type { AssetClass, QuoteService } from "@/lib/quotes/types";

/**
 * Prove a symbol can be priced before an alert is stored, and return the
 * price that becomes the alert's anchor. Crypto is limited to the
 * COINGECKO_IDS map, so an unmapped symbol is rejected here rather than
 * becoming an alert that can never fire.
 */
export async function resolveAlertSymbol(
  rawSymbol: string,
  assetClass: AssetClass,
  baseCurrency: string,
  quotes: QuoteService,
): Promise<{ symbol: string; price: number; currency: string }> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (symbol === "") {
    throw new Error("Symbol is required");
  }

  if (assetClass === "crypto") {
    if (coingeckoIdForSymbol(symbol) == null) {
      throw new Error(
        `${symbol} is not a supported crypto symbol. Add it to COINGECKO_IDS ` +
          `in lib/quotes/crypto-coingecko.ts first.`,
      );
    }
    const fetched = await quotes.getCryptoQuotes([symbol], { force: true });
    const quote = fetched.get(symbol);
    if (!quote) {
      throw new Error(`Could not fetch a price for ${symbol}`);
    }
    return {
      symbol,
      price: quote.price,
      currency: quote.currency.trim().toUpperCase(),
    };
  }

  const quote = await quotes.getQuote(symbol, "equity", {
    force: true,
    preferredCurrency: baseCurrency,
  });
  return {
    symbol,
    price: quote.price,
    currency: quote.currency.trim().toUpperCase(),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/alerts-resolve-symbol.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the server actions**

Create `app/actions/alerts.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createAlert, deleteAlert, setAlertEnabled } from "@/lib/alerts/repo";
import { resolveAlertSymbol } from "@/lib/alerts/resolve-symbol";
import { runAlertsNow, type RunAlertsResult } from "@/lib/alerts/run";
import {
  createTelegramNotifier,
  telegramConfigFromEnv,
} from "@/lib/alerts/telegram";
import type { AlertDirection, AlertKind } from "@/lib/alerts/types";
import { getDb } from "@/lib/db/client";
import { createQuoteService } from "@/lib/quotes/service";
import type { AssetClass } from "@/lib/quotes/types";
import { getSettings } from "@/lib/settings";

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface CreateAlertInput {
  symbol: string;
  assetClass: AssetClass;
  kind: AlertKind;
  direction: AlertDirection;
  targetPrice?: number;
  /** Whole percent as typed by the user: 5 means 5%. */
  percentWhole?: number;
  cooldownMinutes?: number;
  label?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function revalidateAlerts(): void {
  revalidatePath("/alerts");
}

export async function createAlertAction(
  input: CreateAlertInput,
): Promise<ActionResult> {
  try {
    const db = getDb();
    const { baseCurrency } = getSettings(db);
    const resolved = await resolveAlertSymbol(
      input.symbol,
      input.assetClass,
      baseCurrency,
      createQuoteService(db, globalThis.fetch),
    );

    if (input.kind === "threshold") {
      if (input.targetPrice == null || !Number.isFinite(input.targetPrice)) {
        return { ok: false, error: "A target price is required" };
      }
      if (input.targetPrice <= 0) {
        return { ok: false, error: "Target price must be above zero" };
      }
    } else {
      if (input.percentWhole == null || !Number.isFinite(input.percentWhole)) {
        return { ok: false, error: "A percentage is required" };
      }
      if (input.percentWhole <= 0) {
        return { ok: false, error: "Percentage must be above zero" };
      }
    }

    createAlert(db, {
      symbol: resolved.symbol,
      assetClass: input.assetClass,
      kind: input.kind,
      direction: input.direction,
      targetPrice: input.kind === "threshold" ? input.targetPrice : null,
      percent:
        input.kind === "percent_move" ? input.percentWhole! / 100 : null,
      anchorPrice: resolved.price,
      currency: resolved.currency,
      label: input.label,
      cooldownMinutes: input.cooldownMinutes,
    });

    revalidateAlerts();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function deleteAlertAction(id: string): Promise<void> {
  deleteAlert(getDb(), id);
  revalidateAlerts();
}

export async function toggleAlertAction(
  id: string,
  enabled: boolean,
): Promise<void> {
  setAlertEnabled(getDb(), id, enabled);
  revalidateAlerts();
}

export async function runAlertsNowAction(): Promise<RunAlertsResult> {
  const result = await runAlertsNow();
  revalidateAlerts();
  return result;
}

export async function sendTestMessageAction(): Promise<ActionResult> {
  const config = telegramConfigFromEnv();
  if (!config) {
    return {
      ok: false,
      error: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first",
    };
  }
  try {
    await createTelegramNotifier(config, globalThis.fetch).send(
      "✅ Portfolio Ledger test message — alerts are wired up.",
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
```

The page and the settings card call `telegramConfigFromEnv()` directly in
their server components, so no action wraps it.

- [ ] **Step 6: Verify the project still type-checks and every test passes**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; the whole suite passes.

- [ ] **Step 7: Commit**

```bash
git add lib/alerts/resolve-symbol.ts app/actions/alerts.ts \
        tests/alerts-resolve-symbol.test.ts
git commit -m "feat: alert symbol validation and server actions"
```

---

### Task 7: The alerts page

**Files:**
- Create: `app/alerts/page.tsx`
- Create: `components/AlertsManager.tsx`
- Modify: `components/ui/icons.tsx` (add `BellIcon`)
- Modify: `components/AppShell.tsx:11-20` (import `BellIcon`, add the nav link)
- Test: `tests/alerts-ui.test.tsx`

**Interfaces:**
- Consumes: `PriceAlert` from `@/lib/alerts/types`; `createAlertAction`, `deleteAlertAction`, `toggleAlertAction`, `runAlertsNowAction`, `type CreateAlertInput` from `@/app/actions/alerts`; `Button`, `Card`, `DataTable`, `FIELD_CONTROL`, `Page`, `PageHeader` from `@/components/ui/*`; `formatMoney` from `@/lib/format-money`; `listAlerts` from `@/lib/alerts/repo`; `telegramConfigFromEnv` from `@/lib/alerts/telegram`.
- Produces: `AlertsManager({ alerts, telegramConfigured }: { alerts: PriceAlert[]; telegramConfigured: boolean })`; `BellIcon()`.

- [ ] **Step 1: Write the failing test**

Create `tests/alerts-ui.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/alerts", () => ({
  createAlertAction: vi.fn(),
  deleteAlertAction: vi.fn(),
  toggleAlertAction: vi.fn(),
  runAlertsNowAction: vi.fn(),
}));

import { AlertsManager } from "@/components/AlertsManager";
import type { PriceAlert } from "@/lib/alerts/types";

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: "alert-1",
    symbol: "BTC",
    assetClass: "crypto",
    kind: "threshold",
    direction: "above",
    targetPrice: 100_000,
    percent: null,
    anchorPrice: 96_400,
    anchorAt: "2026-08-01T00:00:00.000Z",
    currency: "EUR",
    label: null,
    enabled: true,
    cooldownMinutes: 1440,
    lastFiredAt: null,
    lastCheckedAt: "2026-08-21T12:00:00.000Z",
    lastPrice: 97_100,
    lastError: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AlertsManager", () => {
  it("renders the add form and a threshold row", () => {
    const html = renderToStaticMarkup(
      <AlertsManager alerts={[alert()]} telegramConfigured />,
    );

    expect(html).toContain("Add an alert");
    expect(html).toContain("BTC");
    expect(html).toContain("above");
    expect(html).toContain("€100,000.00");
    expect(html).toContain("€97,100.00");
    expect(html).toContain("Check now");
  });

  it("describes a percent alert as a percentage of its anchor", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[
          alert({
            kind: "percent_move",
            direction: "either",
            targetPrice: null,
            percent: 0.05,
            anchorPrice: 100_000,
          }),
        ]}
        telegramConfigured
      />,
    );

    expect(html).toContain("±5%");
    expect(html).toContain("€100,000.00");
  });

  it("warns when Telegram is not configured", () => {
    const html = renderToStaticMarkup(
      <AlertsManager alerts={[]} telegramConfigured={false} />,
    );
    expect(html).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("shows a recorded error and a disabled state", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[alert({ enabled: false, lastError: "no quote available" })]}
        telegramConfigured
      />,
    );
    expect(html).toContain("no quote available");
    expect(html).toContain("Enable");
  });

  it("says when nothing is set up yet", () => {
    const html = renderToStaticMarkup(
      <AlertsManager alerts={[]} telegramConfigured />,
    );
    expect(html).toContain("No alerts yet");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/alerts-ui.test.tsx`
Expected: FAIL — cannot resolve `@/components/AlertsManager`.

- [ ] **Step 3: Write the client component**

Create `components/AlertsManager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";

import {
  createAlertAction,
  deleteAlertAction,
  runAlertsNowAction,
  toggleAlertAction,
  type CreateAlertInput,
} from "@/app/actions/alerts";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { FIELD_CONTROL } from "@/components/ui/Field";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { PriceAlert } from "@/lib/alerts/types";
import { formatMoney } from "@/lib/format-money";

function describeCondition(alert: PriceAlert): string {
  if (alert.kind === "threshold" && alert.targetPrice != null) {
    return `${alert.direction} ${formatMoney(alert.targetPrice, alert.currency)}`;
  }
  if (alert.percent == null) return "—";
  const whole = Number((alert.percent * 100).toFixed(4));
  const sign =
    alert.direction === "up" ? "+" : alert.direction === "down" ? "−" : "±";
  return `${sign}${whole}%`;
}

function describeStatus(alert: PriceAlert, now: number): string {
  if (!alert.enabled) return "Disabled";
  if (alert.lastError) return alert.lastError;
  if (alert.lastFiredAt) {
    const readyAt =
      new Date(alert.lastFiredAt).getTime() + alert.cooldownMinutes * 60_000;
    if (readyAt > now) {
      return `Cooling down until ${new Date(readyAt).toLocaleString()}`;
    }
  }
  return "Armed";
}

export function AlertsManager({
  alerts,
  telegramConfigured,
}: {
  alerts: PriceAlert[];
  telegramConfigured: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<CreateAlertInput["kind"]>("threshold");
  const now = Date.now();

  function submit(formData: FormData) {
    const chosenKind = formData.get("kind") as CreateAlertInput["kind"];
    const input: CreateAlertInput = {
      symbol: String(formData.get("symbol") ?? ""),
      assetClass: formData.get("assetClass") === "equity" ? "equity" : "crypto",
      kind: chosenKind,
      direction: String(
        formData.get("direction") ?? "above",
      ) as CreateAlertInput["direction"],
      cooldownMinutes: Number(formData.get("cooldownMinutes") ?? 1440),
      label: String(formData.get("label") ?? "") || undefined,
    };
    if (chosenKind === "threshold") {
      input.targetPrice = Number(formData.get("targetPrice"));
    } else {
      input.percentWhole = Number(formData.get("percentWhole"));
    }

    startTransition(async () => {
      const result = await createAlertAction(input);
      setMessage(result.ok ? "Alert created." : result.error);
    });
  }

  return (
    <div className="grid gap-5">
      {!telegramConfigured && (
        <Card className="border-warn/40 p-4 text-[11px] leading-relaxed text-warn">
          Telegram is not configured, so nothing will be sent. Set
          TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID and restart the app.
        </Card>
      )}

      <Card>
        <SectionHeading title="Add an alert" />
        <form action={submit} className={`grid gap-3 p-5 ${FIELD_CONTROL}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="eyebrow">Symbol</span>
              <input name="symbol" required placeholder="BTC" />
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Asset class</span>
              <select name="assetClass" defaultValue="crypto">
                <option value="crypto">Crypto</option>
                <option value="equity">Equity</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Kind</span>
              <select
                name="kind"
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as CreateAlertInput["kind"])
                }
              >
                <option value="threshold">Price threshold</option>
                <option value="percent_move">Percent move</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Direction</span>
              <select
                name="direction"
                defaultValue={kind === "threshold" ? "above" : "either"}
                key={kind}
              >
                {kind === "threshold" ? (
                  <>
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                  </>
                ) : (
                  <>
                    <option value="either">Either way</option>
                    <option value="up">Up only</option>
                    <option value="down">Down only</option>
                  </>
                )}
              </select>
            </label>
            {kind === "threshold" ? (
              <label className="grid gap-1.5">
                <span className="eyebrow">Target price</span>
                <input
                  name="targetPrice"
                  type="number"
                  step="any"
                  min="0"
                  required
                />
              </label>
            ) : (
              <label className="grid gap-1.5">
                <span className="eyebrow">Move (%)</span>
                <input
                  name="percentWhole"
                  type="number"
                  step="any"
                  min="0"
                  defaultValue={5}
                  required
                />
              </label>
            )}
            <label className="grid gap-1.5">
              <span className="eyebrow">Cooldown (minutes)</span>
              <input name="cooldownMinutes" type="number" min="1" defaultValue={1440} />
            </label>
            <label className="grid gap-1.5 sm:col-span-2">
              <span className="eyebrow">Label (optional)</span>
              <input name="label" placeholder="take profit" />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="primary" type="submit" disabled={isPending}>
              Add alert
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await runAlertsNowAction();
                  setMessage(
                    result.skipped
                      ? `Skipped: ${result.skipped}`
                      : `Checked ${result.checked}, fired ${result.fired}, errors ${result.errors}.`,
                  );
                })
              }
            >
              Check now
            </Button>
            {message && (
              <span className="text-[11px] text-dim">{message}</span>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-faint">
            The price is fetched now: a percent alert measures from it, and a
            threshold alert quotes it in the notification. Crypto symbols must
            exist in the CoinGecko map.
          </p>
        </form>
      </Card>

      <Card>
        <SectionHeading title="Alerts" />
        {alerts.length === 0 ? (
          <p className="p-5 text-[11px] text-dim">
            No alerts yet. Add one above.
          </p>
        ) : (
          <DataTable
            head={
              <tr>
                <th>Symbol</th>
                <th>Condition</th>
                <th className="numeric">Reference</th>
                <th className="numeric">Last price</th>
                <th>Status</th>
                <th />
              </tr>
            }
          >
            {alerts.map((alert) => (
              <tr key={alert.id}>
                <td>
                  <span className="font-mono">{alert.symbol}</span>
                  {alert.label && (
                    <span className="ml-2 text-[10px] text-faint">
                      {alert.label}
                    </span>
                  )}
                </td>
                <td>{describeCondition(alert)}</td>
                <td className="numeric">
                  {alert.anchorPrice == null
                    ? "—"
                    : formatMoney(alert.anchorPrice, alert.currency)}
                </td>
                <td className="numeric">
                  {alert.lastPrice == null
                    ? "—"
                    : formatMoney(alert.lastPrice, alert.currency)}
                </td>
                <td
                  className={alert.lastError ? "text-warn" : "text-dim"}
                >
                  {describeStatus(alert, now)}
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    <Button
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          await toggleAlertAction(alert.id, !alert.enabled);
                        })
                      }
                    >
                      {alert.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          await deleteAlertAction(alert.id);
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Write the page and the nav entry**

Create `app/alerts/page.tsx`:

```tsx
import { AlertsManager } from "@/components/AlertsManager";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { listAlerts } from "@/lib/alerts/repo";
import { telegramConfigFromEnv } from "@/lib/alerts/telegram";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const alerts = listAlerts(getDb());

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow="Watchlist"
        title="Alerts"
        description="Price thresholds and percent moves, checked every 10 minutes and delivered by Telegram bot."
      />
      <div className="mt-5">
        <AlertsManager
          alerts={alerts}
          telegramConfigured={telegramConfigFromEnv() != null}
        />
      </div>
    </Page>
  );
}
```

Add to `components/ui/icons.tsx`:

```tsx
export function BellIcon() {
  return (
    <svg {...props}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </svg>
  );
}
```

In `components/AppShell.tsx`, add `BellIcon` to the icon import and insert the
link after Wallets:

```tsx
  { href: "/alerts", label: "Alerts", icon: <BellIcon /> },
```

The mobile tab bar is `grid-cols-5`; with six links change `TAB_NAV`'s first
class to `grid-cols-6`.

- [ ] **Step 5: Cover the nav entry**

Append to `tests/sidebar-nav.test.tsx` (its `next/link` and `next/navigation`
mocks are already hoisted at the top of that file, and `AppShell` is a
synchronous server component, so it renders directly):

```tsx
import { AppShell } from "@/components/AppShell";

describe("AppShell navigation", () => {
  it("links to the alerts page in both navs", () => {
    const html = renderToStaticMarkup(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    expect(html).toContain('href="/alerts"');
    expect(html.match(/href="\/alerts"/g)).toHaveLength(2);
    expect(html).toContain("Alerts");
    expect(html).toContain("grid-cols-6");
  });
});
```

Put the `import { AppShell }` line next to the existing `SidebarNav` import,
below the `vi.mock` calls.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/alerts-ui.test.tsx tests/sidebar-nav.test.tsx`
Expected: PASS. If a `formatMoney` assertion fails, correct the test's expected
string to the real formatter output — do not change `formatMoney`.

- [ ] **Step 7: Verify the page renders and type-checks**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Run: `npm run dev`, open `http://localhost:3000/alerts`
Expected: the Alerts nav entry is present, the form renders, and adding
`BTC / crypto / threshold / above / 1` creates a row showing a reference price
fetched from CoinGecko. Delete it afterwards, then stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add app/alerts/page.tsx components/AlertsManager.tsx \
        components/ui/icons.tsx components/AppShell.tsx \
        tests/alerts-ui.test.tsx tests/sidebar-nav.test.tsx
git commit -m "feat: alerts page with create, toggle, delete and check-now"
```

---

### Task 8: Test-message button on Settings

**Files:**
- Create: `components/TelegramTestButton.tsx`
- Modify: `app/settings/page.tsx`
- Test: `tests/alerts-settings-ui.test.tsx`

**Interfaces:**
- Consumes: `sendTestMessageAction` from `@/app/actions/alerts`; `Button`, `Card`, `SectionHeading`.
- Produces: `TelegramTestButton({ configured }: { configured: boolean })`.

- [ ] **Step 1: Write the failing test**

Create `tests/alerts-settings-ui.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/alerts", () => ({
  sendTestMessageAction: vi.fn(),
}));

import { TelegramTestButton } from "@/components/TelegramTestButton";

describe("TelegramTestButton", () => {
  it("offers a test send when configured", () => {
    const html = renderToStaticMarkup(<TelegramTestButton configured />);
    expect(html).toContain("Send test message");
    // Button's class list contains "disabled:opacity-45", so assert on the
    // rendered attribute, not the substring "disabled".
    expect(html).not.toContain('disabled=""');
  });

  it("disables itself and explains when not configured", () => {
    const html = renderToStaticMarkup(
      <TelegramTestButton configured={false} />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain("TELEGRAM_BOT_TOKEN");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/alerts-settings-ui.test.tsx`
Expected: FAIL — cannot resolve `@/components/TelegramTestButton`.

- [ ] **Step 3: Write the component**

Create `components/TelegramTestButton.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";

import { sendTestMessageAction } from "@/app/actions/alerts";
import { Button } from "@/components/ui/Button";

export function TelegramTestButton({ configured }: { configured: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="grid gap-2 p-5">
      <div className="flex items-center gap-2">
        <Button
          disabled={!configured || isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await sendTestMessageAction();
              setMessage(result.ok ? "Sent." : result.error);
            })
          }
        >
          Send test message
        </Button>
        {message && <span className="text-[11px] text-dim">{message}</span>}
      </div>
      {!configured && (
        <p className="text-[11px] leading-relaxed text-faint">
          Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID and restart the app to
          enable alert delivery.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add it to the settings page**

In `app/settings/page.tsx`, add two imports:

```tsx
import { TelegramTestButton } from "@/components/TelegramTestButton";
import { telegramConfigFromEnv } from "@/lib/alerts/telegram";
```

Then insert this card between the existing "Portfolio currency" `Card` and the
`<div className="mt-4">` that wraps `ResetPortfolioForm` — `mt-4` matches the
spacing the reset block already uses:

```tsx
      <Card className="mt-4">
        <SectionHeading
          eyebrow="Notifications"
          title="Telegram alerts"
          meta={telegramConfigFromEnv() != null ? "configured" : "not set"}
        />
        <TelegramTestButton configured={telegramConfigFromEnv() != null} />
      </Card>
```

- [ ] **Step 5: Run the full suite and type-check**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add components/TelegramTestButton.tsx app/settings/page.tsx \
        tests/alerts-settings-ui.test.tsx
git commit -m "feat: telegram test-message button on settings"
```

---

## Manual verification before merging

- [ ] Create a real bot with @BotFather, message it, read the chat id from `getUpdates`, and put both values in `.env.local`.
- [ ] `ALERTS_ENABLED=1 ALERTS_INTERVAL_MS=60000 npm run dev`, confirm the `[alerts] scheduler on` line.
- [ ] On `/settings`, press **Send test message** and confirm it arrives in Telegram.
- [ ] On `/alerts`, add a threshold alert certain to fire (e.g. BTC above 1) and press **Check now**. Confirm the Telegram message arrives, the row shows a cooldown, and a second **Check now** does not send again.
- [ ] Add a percent alert with `0.0001%`, press **Check now**, and confirm the message quotes a percentage and the reference price advances to the firing price.
- [ ] Try `XYZ` as a crypto symbol and confirm the error names `COINGECKO_IDS`.
- [ ] Delete the test alerts.
