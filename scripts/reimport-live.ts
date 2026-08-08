/**
 * One-off CLI: reset portfolio data and reimport broker CSVs into a SQLite DB.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/reimport-live.ts \
 *     --db /path/to/portfolio.db \
 *     --ibkr /path/to/ibkr.csv \
 *     --cdc /path/to/cdc1.csv --cdc /path/to/cdc2.csv \
 *     --binance-spot /path/to/spot.csv \
 *     --binance-auto /path/to/auto-invest.csv \
 *     [--binance-convert /path/to/convert.csv] \
 *     [--binance-withdraw /path/to/withdraw.csv]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import Database from "better-sqlite3";

import { previewBinanceImport } from "../lib/binance/commit";
import { previewCryptoComImport } from "../lib/cryptocom/commit";
import { migrate } from "../lib/db/migrate";
import { previewIbkrImport } from "../lib/ibkr/commit";
import { combineCsvTexts } from "../lib/import/combine-csv";
import { commitImportWithBatch } from "../lib/import/commit-with-batch";
import { summarizeImportNotes } from "../lib/import/notes";
import { resetPortfolioData } from "../lib/portfolio/reset";

type Args = {
  db: string;
  ibkr: string[];
  cdc: string[];
  binanceSpot: string[];
  binanceAuto: string[];
  binanceConvert: string[];
  binanceWithdraw: string[];
  skipReset: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    db: "",
    ibkr: [],
    cdc: [],
    binanceSpot: [],
    binanceAuto: [],
    binanceConvert: [],
    binanceWithdraw: [],
    skipReset: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value after ${a}`);
      return v;
    };
    switch (a) {
      case "--db":
        args.db = next();
        break;
      case "--ibkr":
        args.ibkr.push(next());
        break;
      case "--cdc":
        args.cdc.push(next());
        break;
      case "--binance-spot":
        args.binanceSpot.push(next());
        break;
      case "--binance-auto":
        args.binanceAuto.push(next());
        break;
      case "--binance-convert":
        args.binanceConvert.push(next());
        break;
      case "--binance-withdraw":
        args.binanceWithdraw.push(next());
        break;
      case "--skip-reset":
        args.skipReset = true;
        break;
      default:
        throw new Error(`Unknown arg: ${a}`);
    }
  }

  if (!args.db) throw new Error("--db is required");
  if (args.ibkr.length === 0) throw new Error("--ibkr is required");
  if (args.cdc.length === 0) throw new Error("--cdc is required");
  if (args.binanceSpot.length === 0) throw new Error("--binance-spot is required");
  if (args.binanceAuto.length === 0) throw new Error("--binance-auto is required");
  return args;
}

function readCombined(paths: string[]): { text: string; fileNames: string[] } {
  const texts = paths.map((p) => readFileSync(p, "utf8"));
  return {
    text: combineCsvTexts(texts),
    fileNames: paths.map((p) => basename(p)),
  };
}

function reportCounts(db: Database.Database) {
  const holdings = (
    db.prepare("SELECT COUNT(*) AS n FROM holdings").get() as { n: number }
  ).n;
  const lots = (
    db.prepare("SELECT COUNT(*) AS n FROM lots").get() as { n: number }
  ).n;
  const batches = db
    .prepare(
      `SELECT id, name, broker, source_detail, lots_inserted, duplicates,
              closed_count, skipped_count, created_at
       FROM import_batches
       ORDER BY created_at`,
    )
    .all();
  return { holdings, lots, batches };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(args.db);
  db.pragma("foreign_keys = ON");
  migrate(db);

  if (!args.skipReset) {
    const wiped = resetPortfolioData(db);
    console.log("RESET", JSON.stringify(wiped));
  }

  // 1) IBKR
  {
    const { text, fileNames } = readCombined(args.ibkr);
    const preview = previewIbkrImport(db, text);
    const noteSummary = summarizeImportNotes(preview.errors);
    const notes = preview.errors.map((e) => e.message);
    const result = commitImportWithBatch(db, preview.toInsert, {
      name: "IBKR Transaction History",
      broker: "ibkr",
      sourceDetail: "trades",
      fileNames,
      duplicates: preview.duplicates.length,
      closedCount: noteSummary.closed,
      skippedCount: noteSummary.skipped,
      notes,
    });
    console.log(
      "IBKR",
      JSON.stringify({
        inserted: result.inserted,
        batchId: result.batchId,
        toInsert: preview.toInsert.length,
        duplicates: preview.duplicates.length,
        errors: preview.errors.length,
        noteSummary,
      }),
    );
  }

  // 2) Crypto.com App (combined)
  {
    const { text, fileNames } = readCombined(args.cdc);
    const preview = previewCryptoComImport(db, text);
    const noteSummary = summarizeImportNotes(preview.errors);
    const notes = preview.errors.map((e) => e.message);
    const result = commitImportWithBatch(db, preview.toInsert, {
      name: "Crypto.com App history",
      broker: "cryptocom",
      sourceDetail: "app",
      fileNames,
      duplicates: preview.duplicates.length,
      closedCount: noteSummary.closed,
      skippedCount: noteSummary.skipped,
      notes,
      csvText: text,
      withdrawals: preview.withdrawals,
    });
    console.log(
      "CRYPTOCOM",
      JSON.stringify({
        inserted: result.inserted,
        batchId: result.batchId,
        toInsert: preview.toInsert.length,
        duplicates: preview.duplicates.length,
        withdrawals: preview.withdrawals.length,
        withCost: preview.withdrawals.filter((w) => w.costBasis != null).length,
        errors: preview.errors.length,
        noteSummary,
      }),
    );
  }

  // 3) Binance Spot
  {
    const { text, fileNames } = readCombined(args.binanceSpot);
    const preview = previewBinanceImport(db, text, "spot");
    const noteSummary = summarizeImportNotes(preview.errors);
    const notes = preview.errors.map((e) => e.message);
    const result = commitImportWithBatch(db, preview.toInsert, {
      name: "Binance Spot Trade History",
      broker: "binance",
      sourceDetail: "spot",
      fileNames,
      duplicates: preview.duplicates.length,
      closedCount: noteSummary.closed,
      skippedCount: noteSummary.skipped,
      notes,
    });
    console.log(
      "BINANCE_SPOT",
      JSON.stringify({
        inserted: result.inserted,
        batchId: result.batchId,
        toInsert: preview.toInsert.length,
        duplicates: preview.duplicates.length,
        errors: preview.errors.length,
        noteSummary,
      }),
    );
  }

  // 4) Binance Auto-Invest
  {
    const { text, fileNames } = readCombined(args.binanceAuto);
    const preview = previewBinanceImport(db, text, "auto-invest");
    const noteSummary = summarizeImportNotes(preview.errors);
    const notes = preview.errors.map((e) => e.message);
    const result = commitImportWithBatch(db, preview.toInsert, {
      name: "Binance Auto-Invest",
      broker: "binance",
      sourceDetail: "auto-invest",
      fileNames,
      duplicates: preview.duplicates.length,
      closedCount: noteSummary.closed,
      skippedCount: noteSummary.skipped,
      notes,
    });
    console.log(
      "BINANCE_AUTO",
      JSON.stringify({
        inserted: result.inserted,
        batchId: result.batchId,
        toInsert: preview.toInsert.length,
        duplicates: preview.duplicates.length,
        errors: preview.errors.length,
        noteSummary,
      }),
    );
  }

  // 5) Binance Convert (optional)
  if (args.binanceConvert.length > 0) {
    const { text, fileNames } = readCombined(args.binanceConvert);
    const preview = previewBinanceImport(db, text, "convert");
    const noteSummary = summarizeImportNotes(preview.errors);
    const notes = preview.errors.map((e) => e.message);
    const result = commitImportWithBatch(db, preview.toInsert, {
      name: "Binance Convert",
      broker: "binance",
      sourceDetail: "convert",
      fileNames,
      duplicates: preview.duplicates.length,
      closedCount: noteSummary.closed,
      skippedCount: noteSummary.skipped,
      notes,
    });
    console.log(
      "BINANCE_CONVERT",
      JSON.stringify({
        inserted: result.inserted,
        batchId: result.batchId,
        toInsert: preview.toInsert.length,
        duplicates: preview.duplicates.length,
        errors: preview.errors.length,
        noteSummary,
      }),
    );
  }

  // 6) Binance Withdraw — re-FIFO spot+convert+auto against withdrawals
  if (args.binanceWithdraw.length > 0) {
    const withdraw = readCombined(args.binanceWithdraw);
    const spot = readCombined(args.binanceSpot);
    const auto = readCombined(args.binanceAuto);
    const convert =
      args.binanceConvert.length > 0
        ? readCombined(args.binanceConvert)
        : { text: "", fileNames: [] as string[] };
    const preview = previewBinanceImport(db, withdraw.text, "withdraw", {
      spotCsv: spot.text,
      convertCsv: convert.text || undefined,
      autoInvestCsv: auto.text,
    });
    const noteSummary = summarizeImportNotes(preview.errors);
    const notes = preview.errors.map((e) => e.message);
    const result = commitImportWithBatch(db, preview.toInsert, {
      name: "Binance Withdraw",
      broker: "binance",
      sourceDetail: "withdraw",
      fileNames: withdraw.fileNames,
      duplicates: preview.duplicates.length,
      closedCount: noteSummary.closed,
      skippedCount: noteSummary.skipped,
      notes,
      withdrawals: preview.withdrawals,
      replaceSymbols: preview.replaceSymbols,
    });
    console.log(
      "BINANCE_WITHDRAW",
      JSON.stringify({
        inserted: result.inserted,
        batchId: result.batchId,
        toInsert: preview.toInsert.length,
        withdrawals: preview.withdrawals?.length ?? 0,
        withCost:
          preview.withdrawals?.filter((w) => w.costBasis != null).length ?? 0,
        replaceSymbols: preview.replaceSymbols,
        errors: preview.errors.length,
        noteSummary,
      }),
    );
  }

  const counts = reportCounts(db);
  console.log("FINAL", JSON.stringify(counts, null, 2));
  db.close();
}

main();
