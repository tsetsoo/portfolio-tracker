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

/**
 * newAnchorPrice re-anchors a percent alert; null leaves the anchor alone.
 * A non-positive value is never a usable anchor — it would satisfy the
 * anchor_price IS NOT NULL check but strand the alert on "missing-anchor"
 * forever with no edit action to recover it — so it is treated the same as
 * null: the existing anchor is left in place. Defence in depth: run.ts
 * already refuses to evaluate a non-positive quote price before it gets
 * this far.
 */
export function recordFire(
  db: Database.Database,
  id: string,
  fire: { firedAt: string; price: number; newAnchorPrice: number | null },
): void {
  const newAnchorPrice =
    fire.newAnchorPrice != null && fire.newAnchorPrice > 0
      ? fire.newAnchorPrice
      : null;

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
    newAnchorPrice,
    newAnchorPrice === null ? null : fire.firedAt,
    id,
  );
}
