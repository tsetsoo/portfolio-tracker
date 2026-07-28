import type Database from "better-sqlite3";

import { commitBinanceImport } from "@/lib/binance/commit";
import type { BinanceTradeRow } from "@/lib/binance/parse";
import { commitCryptoComImport } from "@/lib/cryptocom/commit";
import type { CryptoComTradeRow } from "@/lib/cryptocom/parse";
import { commitIbkrImport } from "@/lib/ibkr/commit";
import type { IbkrTradeRow } from "@/lib/ibkr/parse";
import {
  createImportBatch,
  type ImportBroker,
  updateImportBatchSummary,
} from "@/lib/import/batches";

export type CommitImportMeta = {
  name: string;
  broker: ImportBroker;
  sourceDetail?: string | null;
  fileNames?: string[];
  duplicates?: number;
  closedCount?: number;
  skippedCount?: number;
  notes?: string[];
};

type TradeRow = IbkrTradeRow | BinanceTradeRow | CryptoComTradeRow;

export type CommitImportResult = {
  inserted: number;
  batchId: string;
};

function symbolsTouched(rows: TradeRow[]): string[] {
  return [
    ...new Set(
      rows.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean),
    ),
  ].sort();
}

export function commitImportWithBatch(
  db: Database.Database,
  rows: TradeRow[],
  meta: CommitImportMeta,
): CommitImportResult {
  const name = meta.name.trim();
  if (!name) throw new Error("Import name is required");

  return db.transaction(() => {
    const batch = createImportBatch(db, {
      name,
      broker: meta.broker,
      sourceDetail: meta.sourceDetail ?? null,
      fileNames: meta.fileNames ?? [],
    });

    const options = { importBatchId: batch.id };
    let inserted = 0;
    switch (meta.broker) {
      case "ibkr":
        inserted = commitIbkrImport(db, rows as IbkrTradeRow[], options)
          .inserted;
        break;
      case "binance":
        inserted = commitBinanceImport(db, rows as BinanceTradeRow[], options)
          .inserted;
        break;
      case "cryptocom":
        inserted = commitCryptoComImport(
          db,
          rows as CryptoComTradeRow[],
          options,
        ).inserted;
        break;
    }

    updateImportBatchSummary(db, batch.id, {
      lotsInserted: inserted,
      duplicates: meta.duplicates ?? 0,
      closedCount: meta.closedCount ?? 0,
      skippedCount: meta.skippedCount ?? 0,
      symbolsTouched: symbolsTouched(rows),
      notes: meta.notes ?? [],
    });

    return { inserted, batchId: batch.id };
  })();
}
