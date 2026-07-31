import type Database from "better-sqlite3";

import {
  parseCryptoComTradesCsv,
  type CryptoComTradeRow,
  type ParseResult,
} from "@/lib/cryptocom/parse";
import { extractCryptoComWithdrawals } from "@/lib/cryptocom/withdrawals";
import { addLot, createHolding } from "@/lib/holdings-repo";
import { upsertWalletTransfersFromWithdrawals } from "@/lib/wallets/repo";
import type { CryptoComWithdrawalRow } from "@/lib/wallets/types";

export type CryptoComImportPreview = {
  toInsert: CryptoComTradeRow[];
  duplicates: CryptoComTradeRow[];
  errors: ParseResult["errors"];
  withdrawals: CryptoComWithdrawalRow[];
};

function hasTradeId(db: Database.Database, externalTradeId: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM lots WHERE external_trade_id = ?")
      .get(externalTradeId),
  );
}

export function previewCryptoComImport(
  db: Database.Database,
  csvText: string,
): CryptoComImportPreview {
  const parsed = parseCryptoComTradesCsv(csvText);
  const toInsert: CryptoComTradeRow[] = [];
  const duplicates: CryptoComTradeRow[] = [];
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

  return {
    toInsert,
    duplicates,
    errors: parsed.errors,
    withdrawals: extractCryptoComWithdrawals(csvText),
  };
}

export function commitCryptoComImport(
  db: Database.Database,
  rows: CryptoComTradeRow[],
  options: {
    importBatchId?: string | null;
    withdrawals?: CryptoComWithdrawalRow[];
    csvText?: string;
  } = {},
): { inserted: number; withdrawalsUpserted: number } {
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

    const withdrawals =
      options.withdrawals ??
      (options.csvText
        ? extractCryptoComWithdrawals(options.csvText)
        : []);
    const { upserted: withdrawalsUpserted } =
      upsertWalletTransfersFromWithdrawals(db, withdrawals, {
        importBatchId: options.importBatchId,
        source: "cryptocom",
      });

    return { inserted, withdrawalsUpserted };
  })();
}
