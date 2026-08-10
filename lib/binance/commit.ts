import type Database from "better-sqlite3";

import {
  parseBinanceAutoInvestCsv,
  parseBinanceConvertCsv,
  parseBinanceTradesCsv,
  parseBinanceUnifiedWithdraw,
  type BinanceTradeRow,
  type ParseResult,
} from "@/lib/binance/parse";
import { extractBinanceWithdrawals } from "@/lib/binance/withdrawals";
import { attachWithdrawalCosts, type WithdrawalCost } from "@/lib/cryptocom/parse";
import { addLot, createHolding } from "@/lib/holdings-repo";
import { fifoFxFromDb } from "@/lib/import/fifo-fx";
import {
  netFillsFifo,
  sortKeyFromDate,
  type LotFill,
} from "@/lib/import/fifo-net";
import { upsertWalletTransfersFromWithdrawals } from "@/lib/wallets/repo";
import type { ExchangeWithdrawalRow } from "@/lib/wallets/types";

export type BinanceImportPreview = {
  toInsert: BinanceTradeRow[];
  duplicates: BinanceTradeRow[];
  errors: ParseResult["errors"];
  withdrawals?: ExchangeWithdrawalRow[];
  /** When set, commit replaces existing Binance lots for these symbols. */
  replaceSymbols?: string[];
};

export type BinanceImportFormat =
  | "spot"
  | "auto-invest"
  | "convert"
  | "withdraw";

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

function binanceLotsAsBuyFills(db: Database.Database): LotFill[] {
  const rows = db
    .prepare(
      `SELECT l.quantity, l.cost_per_unit, l.cost_currency, l.purchased_at,
              l.fees, l.external_trade_id, h.symbol
       FROM lots l
       JOIN holdings h ON h.id = l.holding_id
       WHERE h.type = 'crypto'
         AND l.external_trade_id IS NOT NULL
         AND (
           l.external_trade_id LIKE 'binance:%'
           OR l.external_trade_id LIKE 'binance-auto:%'
           OR l.external_trade_id LIKE 'binance-convert:%'
         )
       ORDER BY l.purchased_at, l.external_trade_id`,
    )
    .all() as Array<{
    quantity: number;
    cost_per_unit: number;
    cost_currency: string;
    purchased_at: string;
    fees: number;
    external_trade_id: string;
    symbol: string;
  }>;

  return rows.map((row, index) => ({
    line: index + 2,
    order: index,
    sortKey: sortKeyFromDate(`${row.purchased_at}T12:00:00`),
    side: "BUY" as const,
    row: {
      symbol: row.symbol.toUpperCase(),
      quantity: row.quantity,
      costPerUnit: row.cost_per_unit,
      costCurrency: row.cost_currency,
      purchasedAt: row.purchased_at,
      fees: row.fees,
      externalTradeId: row.external_trade_id,
    },
  }));
}

function deleteBinanceLotsForSymbols(
  db: Database.Database,
  symbols: string[],
): number {
  if (symbols.length === 0) return 0;
  const placeholders = symbols.map(() => "?").join(",");
  return db
    .prepare(
      `DELETE FROM lots
       WHERE external_trade_id IS NOT NULL
         AND (
           external_trade_id LIKE 'binance:%'
           OR external_trade_id LIKE 'binance-auto:%'
           OR external_trade_id LIKE 'binance-convert:%'
         )
         AND holding_id IN (
           SELECT id FROM holdings
           WHERE type = 'crypto' AND UPPER(symbol) IN (${placeholders})
         )`,
    )
    .run(...symbols.map((s) => s.toUpperCase())).changes;
}

/** Preview withdraw import using open Binance lots already in the DB. */
export function previewBinanceWithdrawFromDb(
  db: Database.Database,
  withdrawCsv: string,
): BinanceImportPreview {
  const fx = fifoFxFromDb(db);
  const fills = binanceLotsAsBuyFills(db);
  const extracted = extractBinanceWithdrawals(withdrawCsv);
  let order = fills.length;

  for (const [index, wd] of extracted.entries()) {
    const tx =
      wd.txHash.startsWith("0x") || wd.chain === "eth"
        ? wd.txHash.toLowerCase()
        : wd.txHash;
    fills.push({
      line: 9000 + index,
      order: order++,
      sortKey: sortKeyFromDate(wd.transferredAt),
      side: "SELL",
      disposition: "withdrawal",
      row: {
        symbol: wd.asset,
        quantity: wd.fifoQuantity,
        costPerUnit: 0,
        costCurrency: "EUR",
        purchasedAt: wd.transferredAt.slice(0, 10),
        fees: 0,
        externalTradeId: `binance:${tx}`,
      },
    });
  }

  const netted = netFillsFifo(fills, fx);
  const withdrawalCosts: WithdrawalCost[] = netted.consumed
    .filter(
      (row) =>
        row.disposition === "withdrawal" &&
        row.externalTradeId != null &&
        row.externalTradeId !== "",
    )
    .map((row) => ({
      externalTradeId: row.externalTradeId!,
      asset: row.symbol,
      quantity: row.quantity,
      costBasis: row.costBasis,
      costCurrency: row.costCurrency,
      partial: row.partial,
      missingCurrencies: row.missingCurrencies,
    }));

  const withdrawals = attachWithdrawalCosts(
    extracted.map((wd) => ({
      chain: wd.chain,
      asset: wd.asset,
      amount: wd.amount,
      txHash: wd.txHash,
      transferredAt: wd.transferredAt.slice(0, 10),
    })),
    withdrawalCosts,
  );

  const symbols = [
    ...new Set([
      ...netted.rows.map((r) => r.symbol.toUpperCase()),
      ...extracted.map((w) => w.asset.toUpperCase()),
    ]),
  ];

  return {
    toInsert: netted.rows,
    duplicates: [],
    errors: netted.errors,
    withdrawals,
    replaceSymbols: symbols,
  };
}

export function previewBinanceImport(
  db: Database.Database,
  csvText: string,
  format: BinanceImportFormat = "spot",
  options: {
    spotCsv?: string;
    convertCsv?: string;
    autoInvestCsv?: string;
  } = {},
): BinanceImportPreview {
  if (format === "withdraw") {
    if (options.spotCsv || options.convertCsv || options.autoInvestCsv) {
      const parsed = parseBinanceUnifiedWithdraw({
        withdrawCsv: csvText,
        spotCsv: options.spotCsv,
        convertCsv: options.convertCsv,
        autoInvestCsv: options.autoInvestCsv,
        fx: fifoFxFromDb(db),
      });
      const symbols = [
        ...new Set([
          ...parsed.rows.map((r) => r.symbol.toUpperCase()),
          ...(parsed.withdrawals ?? []).map((w) => w.asset.toUpperCase()),
        ]),
      ];
      return {
        toInsert: parsed.rows,
        duplicates: [],
        errors: parsed.errors,
        withdrawals: parsed.withdrawals,
        replaceSymbols: symbols,
      };
    }
    return previewBinanceWithdrawFromDb(db, csvText);
  }

  const parsed =
    format === "auto-invest"
      ? parseBinanceAutoInvestCsv(csvText)
      : format === "convert"
        ? parseBinanceConvertCsv(csvText)
        : parseBinanceTradesCsv(csvText);
  return previewFromParsed(db, parsed);
}

export function commitBinanceImport(
  db: Database.Database,
  rows: BinanceTradeRow[],
  options: {
    importBatchId?: string | null;
    withdrawals?: ExchangeWithdrawalRow[];
    replaceSymbols?: string[];
  } = {},
): { inserted: number; withdrawalsUpserted: number; lotsDeleted: number } {
  return db.transaction(() => {
    let lotsDeleted = 0;
    if (options.replaceSymbols && options.replaceSymbols.length > 0) {
      lotsDeleted = deleteBinanceLotsForSymbols(db, options.replaceSymbols);
    }

    let inserted = 0;
    for (const row of rows) {
      if (
        !options.replaceSymbols?.length &&
        row.externalTradeId &&
        hasTradeId(db, row.externalTradeId)
      ) {
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

      // After replace, trade ids may collide if re-inserted; skip dupes.
      if (row.externalTradeId && hasTradeId(db, row.externalTradeId)) {
        continue;
      }

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

    let withdrawalsUpserted = 0;
    if (options.withdrawals && options.withdrawals.length > 0) {
      withdrawalsUpserted = upsertWalletTransfersFromWithdrawals(
        db,
        options.withdrawals,
        {
          importBatchId: options.importBatchId,
          source: "binance",
        },
      ).upserted;
    }

    return { inserted, withdrawalsUpserted, lotsDeleted };
  })();
}
