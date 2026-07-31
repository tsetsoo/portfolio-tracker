/**
 * Offline reimport against a local copy of the Pi SQLite DB.
 * Usage: npx tsx scripts/reimport-all.mts /path/to/portfolio.db
 */
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

import {
  parseBinanceAutoInvestCsv,
  parseBinanceTradesCsv,
} from "../lib/binance/parse.ts";
import { parseCryptoComTradesCsv } from "../lib/cryptocom/parse.ts";
import { parseIbkrTradesCsv } from "../lib/ibkr/parse.ts";
import { combineCsvTexts } from "../lib/import/combine-csv.ts";
import { commitImportWithBatch } from "../lib/import/commit-with-batch.ts";
import { resetPortfolioData } from "../lib/portfolio/reset.ts";
import { migrate } from "../lib/db/migrate.ts";

const D = "/Users/tsvetelinpantev/Downloads";
const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: npx tsx scripts/reimport-all.mts /path/to/portfolio.db");
  process.exit(1);
}

const db = new Database(dbPath);
migrate(db);

const before = {
  holdings: (db.prepare("SELECT COUNT(*) AS n FROM holdings").get() as { n: number }).n,
  lots: (db.prepare("SELECT COUNT(*) AS n FROM lots").get() as { n: number }).n,
  batches: (db.prepare("SELECT COUNT(*) AS n FROM import_batches").get() as { n: number }).n,
};
console.log("before", before);

const reset = resetPortfolioData(db);
console.log("reset", reset);

function notesFromErrors(
  errors: { message: string }[],
  max = 40,
): string[] {
  return errors.map((e) => e.message).slice(0, max);
}

// IBKR
{
  const file = "U23181408.TRANSACTIONS.1Y.csv";
  const parsed = parseIbkrTradesCsv(readFileSync(`${D}/${file}`, "utf8"));
  const result = commitImportWithBatch(db, parsed.rows, {
    name: "IBKR Transaction History",
    broker: "ibkr",
    sourceDetail: "trades",
    fileNames: [file],
    duplicates: 0,
    closedCount: 0,
    skippedCount: 0,
    notes: notesFromErrors(parsed.errors),
  });
  console.log("IBKR", { openLots: parsed.rows.length, inserted: result.inserted });
}

// CDC
{
  const files = [
    "crypto_transactions_record_20260727_111330.csv",
    "crypto_transactions_record_20260727_111249.csv",
  ];
  const combined = combineCsvTexts(
    files.map((f) => readFileSync(`${D}/${f}`, "utf8")),
  );
  const parsed = parseCryptoComTradesCsv(combined);
  const closed = parsed.errors.filter((e) =>
    /applied (sell|withdrawal)|closed position/i.test(e.message),
  ).length;
  const skipped = parsed.errors.filter((e) =>
    /^Skipped /i.test(e.message),
  ).length;
  const result = commitImportWithBatch(db, parsed.rows, {
    name: "Crypto.com App history",
    broker: "cryptocom",
    sourceDetail: "app",
    fileNames: files,
    duplicates: 0,
    closedCount: closed,
    skippedCount: skipped,
    notes: notesFromErrors(parsed.errors),
  });
  console.log("CDC", {
    openLots: parsed.rows.length,
    inserted: result.inserted,
    closed,
    skipped,
  });
}

// Spot
{
  const file =
    "Binance-Spot-Trade-History-202607271313(UTC+3)-part1-of1.csv";
  const parsed = parseBinanceTradesCsv(readFileSync(`${D}/${file}`, "utf8"));
  const ids = new Set<string>();
  let duplicates = 0;
  const toInsert = [];
  for (const row of parsed.rows) {
    const id = row.externalTradeId ?? "";
    if (id && ids.has(id)) {
      duplicates += 1;
      continue;
    }
    if (id) ids.add(id);
    toInsert.push(row);
  }
  const closed = parsed.errors.filter((e) =>
    /applied sell|closed position/i.test(e.message),
  ).length;
  const skipped = parsed.errors.filter((e) =>
    /^Skipped /i.test(e.message),
  ).length;
  const result = commitImportWithBatch(db, toInsert, {
    name: "Binance Spot Trade History",
    broker: "binance",
    sourceDetail: "spot",
    fileNames: [file],
    duplicates,
    closedCount: closed,
    skippedCount: skipped,
    notes: notesFromErrors(parsed.errors),
  });
  console.log("Spot", {
    openLots: parsed.rows.length,
    unique: toInsert.length,
    duplicates,
    inserted: result.inserted,
  });
}

// Auto-Invest
{
  const file =
    "Binance-Auto-Invest-History-202607271314(UTC+3)-part1-of1.csv";
  const parsed = parseBinanceAutoInvestCsv(
    readFileSync(`${D}/${file}`, "utf8"),
  );
  const skipped = parsed.errors.filter((e) =>
    /^Skipped /i.test(e.message),
  ).length;
  const result = commitImportWithBatch(db, parsed.rows, {
    name: "Binance Auto-Invest",
    broker: "binance",
    sourceDetail: "auto-invest",
    fileNames: [file],
    duplicates: 0,
    closedCount: 0,
    skippedCount: skipped,
    notes: notesFromErrors(parsed.errors),
  });
  console.log("Auto-Invest", {
    openLots: parsed.rows.length,
    inserted: result.inserted,
    skipped,
  });
}

const after = db
  .prepare(
    `SELECT h.symbol, COUNT(*) lots, ROUND(SUM(l.quantity),10) qty
     FROM lots l JOIN holdings h ON h.id=l.holding_id
     WHERE l.quantity > 0
     GROUP BY h.symbol ORDER BY h.symbol`,
  )
  .all();
console.log("\n=== OPEN HOLDINGS ===");
for (const row of after) console.log(row);

console.log(
  "\ntotals",
  {
    holdings: (db.prepare("SELECT COUNT(*) AS n FROM holdings").get() as { n: number }).n,
    lots: (db.prepare("SELECT COUNT(*) AS n FROM lots").get() as { n: number }).n,
    batches: (db.prepare("SELECT COUNT(*) AS n FROM import_batches").get() as { n: number }).n,
  },
);

db.close();
