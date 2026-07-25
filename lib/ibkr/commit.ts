import type Database from "better-sqlite3";

import { createHolding, addLot } from "@/lib/holdings-repo";
import {
  parseIbkrTradesCsv,
  type IbkrTradeRow,
  type ParseResult,
} from "@/lib/ibkr/parse";

export type IbkrImportPreview = {
  toInsert: IbkrTradeRow[];
  duplicates: IbkrTradeRow[];
  errors: ParseResult["errors"];
};

function hasTradeId(db: Database.Database, externalTradeId: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM lots WHERE external_trade_id = ?")
      .get(externalTradeId),
  );
}

export function previewIbkrImport(
  db: Database.Database,
  csvText: string,
): IbkrImportPreview {
  const parsed = parseIbkrTradesCsv(csvText);
  const toInsert: IbkrTradeRow[] = [];
  const duplicates: IbkrTradeRow[] = [];
  const seenTradeIds = new Set<string>();

  for (const row of parsed.rows) {
    const tradeId = row.externalTradeId;
    if (
      tradeId &&
      (seenTradeIds.has(tradeId) || hasTradeId(db, tradeId))
    ) {
      duplicates.push(row);
      continue;
    }

    toInsert.push(row);
    if (tradeId) seenTradeIds.add(tradeId);
  }

  return { toInsert, duplicates, errors: parsed.errors };
}

export function commitIbkrImport(
  db: Database.Database,
  rows: IbkrTradeRow[],
): { inserted: number } {
  return db.transaction(() => {
    let inserted = 0;

    for (const row of rows) {
      if (row.externalTradeId && hasTradeId(db, row.externalTradeId)) {
        continue;
      }

      const symbol = row.symbol.trim().toUpperCase();
      const existing = db
        .prepare(
          `SELECT id
           FROM holdings
           WHERE type = 'equity' AND UPPER(symbol) = ?
           ORDER BY id
           LIMIT 1`,
        )
        .get(symbol) as { id: string } | undefined;

      const holdingId =
        existing?.id ??
        createHolding(db, {
          type: "equity",
          symbol,
          name: symbol,
          quoteCurrency: row.costCurrency,
        }).id;

      addLot(db, holdingId, {
        quantity: row.quantity,
        costPerUnit: row.costPerUnit,
        costCurrency: row.costCurrency,
        purchasedAt: row.purchasedAt,
        fees: row.fees,
        externalTradeId: row.externalTradeId,
      });
      inserted += 1;
    }

    return { inserted };
  })();
}
