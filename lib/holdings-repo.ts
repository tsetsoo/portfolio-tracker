import crypto from "node:crypto";
import type Database from "better-sqlite3";

import type { Holding, HoldingType, Lot } from "@/lib/domain/types";

interface HoldingRow {
  id: string;
  type: HoldingType;
  symbol: string | null;
  name: string;
  quote_currency: string | null;
  manual_value: number | null;
  notes: string | null;
  updated_at: string;
}

interface LotRow {
  id: string;
  holding_id: string;
  quantity: number;
  cost_per_unit: number;
  cost_currency: string;
  purchased_at: string;
  fees: number;
  external_trade_id: string | null;
}

export interface CreateLotInput {
  quantity: number;
  costPerUnit: number;
  costCurrency: string;
  purchasedAt: string;
  fees?: number;
  externalTradeId?: string | null;
}

export interface CreateHoldingInput {
  type: HoldingType;
  name: string;
  symbol?: string | null;
  quoteCurrency?: string | null;
  manualValue?: number | null;
  lot?: CreateLotInput;
}

export interface HoldingWithLots extends Holding {
  lots: Lot[];
}

function mapHolding(row: HoldingRow): Holding {
  return {
    id: row.id,
    type: row.type,
    symbol: row.symbol,
    name: row.name,
    quoteCurrency: row.quote_currency,
    manualValue: row.manual_value,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

function mapLot(row: LotRow): Lot {
  return {
    id: row.id,
    holdingId: row.holding_id,
    quantity: row.quantity,
    costPerUnit: row.cost_per_unit,
    costCurrency: row.cost_currency,
    purchasedAt: row.purchased_at,
    fees: row.fees,
    externalTradeId: row.external_trade_id,
  };
}

export function listHoldingsWithLots(
  db: Database.Database,
): HoldingWithLots[] {
  const holdings = db
    .prepare(
      `SELECT id, type, symbol, name, quote_currency, manual_value, notes, updated_at
       FROM holdings
       ORDER BY name, id`,
    )
    .all() as HoldingRow[];
  const lots = db
    .prepare(
      `SELECT id, holding_id, quantity, cost_per_unit, cost_currency,
              purchased_at, fees, external_trade_id
       FROM lots
       ORDER BY purchased_at, id`,
    )
    .all() as LotRow[];
  const lotsByHolding = new Map<string, Lot[]>();

  for (const row of lots) {
    const mapped = mapLot(row);
    const holdingLots = lotsByHolding.get(mapped.holdingId) ?? [];
    holdingLots.push(mapped);
    lotsByHolding.set(mapped.holdingId, holdingLots);
  }

  return holdings.map((row) => {
    const holding = mapHolding(row);
    return { ...holding, lots: lotsByHolding.get(holding.id) ?? [] };
  });
}

export function createHolding(
  db: Database.Database,
  input: CreateHoldingInput,
): Holding {
  return db.transaction(() => {
    const holding: Holding = {
      id: crypto.randomUUID(),
      type: input.type,
      symbol: input.symbol ?? null,
      name: input.name,
      quoteCurrency: input.quoteCurrency ?? null,
      manualValue: input.manualValue ?? null,
      notes: null,
      updatedAt: new Date().toISOString(),
    };

    db.prepare(
      `INSERT INTO holdings (
         id, type, symbol, name, quote_currency, manual_value, notes, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      holding.id,
      holding.type,
      holding.symbol,
      holding.name,
      holding.quoteCurrency,
      holding.manualValue,
      holding.notes,
      holding.updatedAt,
    );

    if (input.lot) addLot(db, holding.id, input.lot);
    return holding;
  })();
}

export function addLot(
  db: Database.Database,
  holdingId: string,
  input: CreateLotInput,
): Lot {
  const lot: Lot = {
    id: crypto.randomUUID(),
    holdingId,
    quantity: input.quantity,
    costPerUnit: input.costPerUnit,
    costCurrency: input.costCurrency,
    purchasedAt: input.purchasedAt,
    fees: input.fees ?? 0,
    externalTradeId: input.externalTradeId ?? null,
  };

  db.prepare(
    `INSERT INTO lots (
       id, holding_id, quantity, cost_per_unit, cost_currency,
       purchased_at, fees, external_trade_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    lot.id,
    lot.holdingId,
    lot.quantity,
    lot.costPerUnit,
    lot.costCurrency,
    lot.purchasedAt,
    lot.fees,
    lot.externalTradeId,
  );

  return lot;
}

export function updateManualValue(
  db: Database.Database,
  holdingId: string,
  value: number,
): Holding {
  const updatedAt = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE holdings
       SET manual_value = ?, updated_at = ?
       WHERE id = ? AND type = 'manual'`,
    )
    .run(value, updatedAt, holdingId);

  if (result.changes === 0) {
    throw new Error(`Manual holding not found: ${holdingId}`);
  }

  const row = db
    .prepare(
      `SELECT id, type, symbol, name, quote_currency, manual_value, notes, updated_at
       FROM holdings
       WHERE id = ?`,
    )
    .get(holdingId) as HoldingRow;
  return mapHolding(row);
}

export function deleteHolding(
  db: Database.Database,
  holdingId: string,
): void {
  db.prepare("DELETE FROM holdings WHERE id = ?").run(holdingId);
}
