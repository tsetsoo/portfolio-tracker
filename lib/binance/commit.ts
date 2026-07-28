import type Database from "better-sqlite3";

import {
  parseBinanceAutoInvestCsv,
  parseBinanceTradesCsv,
  type BinanceTradeRow,
  type ParseResult,
} from "@/lib/binance/parse";
import { addLot, createHolding } from "@/lib/holdings-repo";

export type BinanceImportPreview = {
  toInsert: BinanceTradeRow[];
  duplicates: BinanceTradeRow[];
  errors: ParseResult["errors"];
};

export type BinanceImportFormat = "spot" | "auto-invest";

function hasTradeId(db: Database.Database, externalTradeId: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM lots WHERE external_trade_id = ?")
      .get(externalTradeId),
  );
}

function previewFromParsed(
  db: Database.Database,
  parsed: ParseResult,
): BinanceImportPreview {
  const toInsert: BinanceTradeRow[] = [];
  const duplicates: BinanceTradeRow[] = [];
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

export function previewBinanceImport(
  db: Database.Database,
  csvText: string,
  format: BinanceImportFormat = "spot",
): BinanceImportPreview {
  const parsed =
    format === "auto-invest"
      ? parseBinanceAutoInvestCsv(csvText)
      : parseBinanceTradesCsv(csvText);
  return previewFromParsed(db, parsed);
}

export function commitBinanceImport(
  db: Database.Database,
  rows: BinanceTradeRow[],
  options: { importBatchId?: string | null } = {},
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
           WHERE type = 'crypto' AND UPPER(symbol) = ?
           ORDER BY id
           LIMIT 1`,
        )
        .get(symbol) as { id: string } | undefined;

      const holdingId =
        existing?.id ??
        createHolding(db, {
          type: "crypto",
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
        importBatchId: options.importBatchId,
      });
      inserted += 1;
    }

    return { inserted };
  })();
}
