import { readFileSync } from "node:fs";
import { basename } from "node:path";

import Database from "better-sqlite3";

import { previewBinanceImport } from "../lib/binance/commit";
import { migrate } from "../lib/db/migrate";
import { commitImportWithBatch } from "../lib/import/commit-with-batch";
import { summarizeImportNotes } from "../lib/import/notes";

const csvPath =
  process.argv[2] ??
  "/Users/tsvetelinpantev/Downloads/Binance-Convert-Order-History-202608070716(UTC+3)-part1-of1.csv";

const targets = [
  ".tmp-reimport/portfolio.btc-check.20260805T132131Z.db",
  "data/portfolio.db",
];

const csv = readFileSync(csvPath, "utf8");

for (const dbPath of targets) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  migrate(db);

  const cleared = db
    .prepare("DELETE FROM lots WHERE external_trade_id LIKE 'binance-convert:%'")
    .run().changes;
  db.prepare(
    `DELETE FROM holdings
     WHERE id NOT IN (SELECT DISTINCT holding_id FROM lots)
       AND type = 'crypto'
       AND UPPER(symbol) IN ('USDT','USDC')`,
  ).run();
  db.prepare(
    `DELETE FROM import_batches
     WHERE broker = 'binance' AND source_detail = 'convert'`,
  ).run();

  const preview = previewBinanceImport(db, csv, "convert");
  const bySym: Record<string, { qty: number; n: number }> = {};
  for (const r of preview.toInsert) {
    bySym[r.symbol] ??= { qty: 0, n: 0 };
    bySym[r.symbol]!.qty += r.quantity;
    bySym[r.symbol]!.n += 1;
  }
  const noteSummary = summarizeImportNotes(preview.errors);
  const result = commitImportWithBatch(db, preview.toInsert, {
    name: "Binance Convert 2026-08-07",
    broker: "binance",
    sourceDetail: "convert",
    fileNames: [basename(csvPath)],
    duplicates: preview.duplicates.length,
    closedCount: noteSummary.closed,
    skippedCount: noteSummary.skipped,
    notes: preview.errors.map((e) => e.message),
  });
  console.log(
    JSON.stringify(
      {
        dbPath,
        clearedConvertLots: cleared,
        inserted: result.inserted,
        batchId: result.batchId,
        bySymbol: bySym,
        skippedNotes: preview.errors.map((e) => e.message),
      },
      null,
      2,
    ),
  );
  db.close();
}
