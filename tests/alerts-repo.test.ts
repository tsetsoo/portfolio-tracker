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

  it("refuses to write a non-positive anchor, leaving the existing anchor in place", () => {
    // A zero or negative anchor would satisfy the anchor_price IS NOT NULL
    // check but strand the alert on "missing-anchor" forever, with no edit
    // action to recover it. run.ts already refuses to evaluate a
    // non-positive quote price before this point; this is defence in depth.
    const alert = createAlert(db, {
      symbol: "ETH",
      assetClass: "crypto",
      kind: "percent_move",
      direction: "either",
      percent: 0.05,
      anchorPrice: 3_000,
      currency: "EUR",
    });

    recordFire(db, alert.id, {
      firedAt: "2026-08-21T10:00:00.000Z",
      price: 0,
      newAnchorPrice: 0,
    });

    const afterZero = getAlert(db, alert.id);
    expect(afterZero?.anchorPrice).toBe(3_000);
    expect(afterZero?.anchorAt).toBe(alert.createdAt);
    // The fire itself (last_fired_at/last_price) still recorded — only the
    // anchor write is guarded.
    expect(afterZero?.lastFiredAt).toBe("2026-08-21T10:00:00.000Z");

    recordFire(db, alert.id, {
      firedAt: "2026-08-21T11:00:00.000Z",
      price: -5,
      newAnchorPrice: -5,
    });

    const afterNegative = getAlert(db, alert.id);
    expect(afterNegative?.anchorPrice).toBe(3_000);
    expect(afterNegative?.anchorAt).toBe(alert.createdAt);
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

  it("rejects a non-positive cooldown", () => {
    // This CHECK only protects fresh databases: the table is created with
    // CREATE TABLE IF NOT EXISTS, so an already-provisioned database keeps
    // its constraint-free cooldown_minutes column, and createAlertAction is
    // what protects those.
    expect(() =>
      createAlert(db, {
        symbol: "BTC",
        assetClass: "crypto",
        kind: "threshold",
        direction: "above",
        targetPrice: 100_000,
        anchorPrice: 96_400,
        currency: "EUR",
        cooldownMinutes: 0,
      }),
    ).toThrow();

    expect(() =>
      createAlert(db, {
        symbol: "BTC",
        assetClass: "crypto",
        kind: "threshold",
        direction: "above",
        targetPrice: 100_000,
        anchorPrice: 96_400,
        currency: "EUR",
        cooldownMinutes: -5,
      }),
    ).toThrow();
  });

  it("clears a stale last_error on enable, but keeps it on disable", () => {
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

    setAlertEnabled(db, alert.id, false);
    expect(getAlert(db, alert.id)?.enabled).toBe(false);
    expect(getAlert(db, alert.id)?.lastError).toBe("no quote available");

    setAlertEnabled(db, alert.id, true);
    expect(getAlert(db, alert.id)?.enabled).toBe(true);
    expect(getAlert(db, alert.id)?.lastError).toBeNull();
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
