/**
 * Repair wallet transfer cost bases using dated (historical) USD/EUR FX
 * rates, instead of the single "latest" rate used at original import time.
 *
 * Re-runs the same Binance unified-withdraw FIFO and Crypto.com FIFO used
 * during import, but with `fx_rates_daily`-backed FX so mixed-currency lots
 * (e.g. USDT/USD Binance buys feeding a EUR-base withdrawal) settle against
 * the historical rate on each lot's purchase date rather than "now".
 *
 * This script never wipes wallets, resets the portfolio, or replaces lots —
 * it only recomputes `wallet_transfers.cost_basis` for existing rows, and
 * (via `applyWithdrawalCostsSkippingGift`) never overwrites a transfer
 * already marked `cost_status = 'gift'`.
 *
 * Dry-run by default; pass --apply to persist.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/repair-wallet-costs.ts \
 *     --db .tmp-reimport/portfolio.repair.db \
 *     --binance-withdraw "$HOME/Downloads/Binance-Withdraw-History-*.csv" \
 *     --binance-spot "$HOME/Downloads/Binance-Spot-Trade-History-*.csv" \
 *     --binance-convert "$HOME/Downloads/Binance-Convert-Order-History-*.csv" \
 *     --binance-auto "$HOME/Downloads/Binance-Auto-Invest-History-*.csv" \
 *     --cdc "$HOME/Downloads/crypto_transactions_record_1.csv" \
 *     --cdc "$HOME/Downloads/crypto_transactions_record_2.csv" \
 *     --cdc "$HOME/Downloads/crypto_transactions_record_3.csv" \
 *     [--apply]
 */
import { readFileSync } from "node:fs";

import Database from "better-sqlite3";

import { previewBinanceImport } from "@/lib/binance/commit";
import { previewCryptoComImport } from "@/lib/cryptocom/commit";
import { migrate } from "@/lib/db/migrate";
import { combineCsvTexts } from "@/lib/import/combine-csv";
import { collectPurchaseDates } from "@/lib/import/collect-purchase-dates";
import { prefetchUsdEurDailyRates } from "@/lib/import/fx-daily";
import {
  applyWithdrawalCostsSkippingGift,
  listWalletTransfers,
} from "@/lib/wallets/repo";
import type { ExchangeWithdrawalRow, WalletTransfer } from "@/lib/wallets/types";

/** ETH tx used as the sanity gate: must show cost_basis/amount >= 100 EUR. */
const GATE_TX_HASH_PREFIX = "0xabc4467c";
const GATE_MIN_EUR_PER_UNIT = 100;

type Args = {
  db: string;
  cdc: string[];
  binanceSpot: string[];
  binanceConvert: string[];
  binanceAuto: string[];
  binanceWithdraw: string[];
  apply: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    db: "",
    cdc: [],
    binanceSpot: [],
    binanceConvert: [],
    binanceAuto: [],
    binanceWithdraw: [],
    apply: false,
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
      case "--cdc":
        args.cdc.push(next());
        break;
      case "--binance-spot":
        args.binanceSpot.push(next());
        break;
      case "--binance-convert":
        args.binanceConvert.push(next());
        break;
      case "--binance-auto":
        args.binanceAuto.push(next());
        break;
      case "--binance-withdraw":
        args.binanceWithdraw.push(next());
        break;
      case "--apply":
        args.apply = true;
        break;
      default:
        throw new Error(`Unknown arg: ${a}`);
    }
  }

  if (!args.db) throw new Error("--db is required");
  return args;
}

function readCombined(paths: string[]): string {
  if (paths.length === 0) return "";
  return combineCsvTexts(paths.map((p) => readFileSync(p, "utf8")));
}

function transfersByTxHash(
  db: Database.Database,
): Map<string, WalletTransfer> {
  const byHash = new Map<string, WalletTransfer>();
  for (const transfer of listWalletTransfers(db)) {
    byHash.set(transfer.txHash.toLowerCase(), transfer);
  }
  return byHash;
}

/** Merge withdrawal rows from multiple sources, keyed by chain+txHash. */
function mergeWithdrawals(
  ...groups: ExchangeWithdrawalRow[][]
): ExchangeWithdrawalRow[] {
  const byKey = new Map<string, ExchangeWithdrawalRow>();
  for (const group of groups) {
    for (const row of group) {
      byKey.set(`${row.chain}:${row.txHash.toLowerCase()}`, row);
    }
  }
  return [...byKey.values()];
}

type GateRow = {
  tx_hash: string;
  amount: number;
  cost_basis: number | null;
  cost_currency: string | null;
  cost_status: string;
};

function readGateRow(db: Database.Database): GateRow | undefined {
  return db
    .prepare(
      `SELECT tx_hash, amount, cost_basis, cost_currency, cost_status
       FROM wallet_transfers WHERE tx_hash LIKE ?`,
    )
    .get(`${GATE_TX_HASH_PREFIX}%`) as GateRow | undefined;
}

/** Read current + proposed cost for the sanity-gate tx (null if not found). */
function inspectGateTx(
  db: Database.Database,
  withdrawals: ExchangeWithdrawalRow[],
): {
  txHash: string | null;
  currentEurPerUnit: number | null;
  currentStatus: string | null;
  proposedEurPerUnit: number | null;
  proposedStatus: string | null;
} {
  const existing = readGateRow(db);

  if (!existing) {
    return {
      txHash: null,
      currentEurPerUnit: null,
      currentStatus: null,
      proposedEurPerUnit: null,
      proposedStatus: null,
    };
  }

  const currentEurPerUnit =
    existing.cost_basis != null && existing.amount > 0
      ? existing.cost_basis / existing.amount
      : null;

  const proposed = withdrawals.find(
    (w) => w.txHash.toLowerCase() === existing.tx_hash.toLowerCase(),
  );
  const proposedEurPerUnit =
    proposed?.costBasis != null && existing.amount > 0
      ? proposed.costBasis / existing.amount
      : null;

  return {
    txHash: existing.tx_hash,
    currentEurPerUnit,
    currentStatus: existing.cost_status,
    proposedEurPerUnit,
    proposedStatus: proposed?.costStatus ?? null,
  };
}

/** Post-apply re-read: confirm the gate tx actually landed >= threshold and non-gift. */
function verifyGateAfterApply(db: Database.Database): {
  ok: boolean;
  txHash: string | null;
  eurPerUnit: number | null;
  status: string | null;
} {
  const row = readGateRow(db);
  if (!row) {
    return { ok: false, txHash: null, eurPerUnit: null, status: null };
  }
  const eurPerUnit =
    row.cost_basis != null && row.amount > 0
      ? row.cost_basis / row.amount
      : null;
  const ok =
    row.cost_status !== "gift" &&
    eurPerUnit != null &&
    eurPerUnit >= GATE_MIN_EUR_PER_UNIT;
  return { ok, txHash: row.tx_hash, eurPerUnit, status: row.cost_status };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(args.db);
  db.pragma("foreign_keys = ON");
  migrate(db);

  try {
    const withdrawCsv = readCombined(args.binanceWithdraw);
    const spotCsv = readCombined(args.binanceSpot);
    const convertCsv = readCombined(args.binanceConvert);
    const autoCsv = readCombined(args.binanceAuto);
    // Combine all --cdc files into one CSV so FIFO sees the full chronological
    // buy/sell history in one pass (matches reimport-live.ts) — FIFO-ing each
    // CDC file in isolation would double-count/miss lots that span files.
    const cdcCsv = readCombined(args.cdc);

    // 1) Prefetch dated USD/EUR FX BEFORE FIFO — FIFO's FX lookup is sync
    // against the DB cache; Frankfurter needs network.
    const purchaseDates = collectPurchaseDates({
      binanceSpotCsv: spotCsv,
      binanceConvertCsv: convertCsv,
      binanceAutoCsv: autoCsv,
      cdcCsvs: cdcCsv ? [cdcCsv] : [],
    });
    console.log(`Prefetching FX for ${purchaseDates.length} unique dates…`);
    const prefetch = await prefetchUsdEurDailyRates(db, purchaseDates, fetch);
    console.log(
      `FX prefetch: fetched=${prefetch.fetched} failed=${prefetch.failed.length}`,
    );
    if (prefetch.failed.length > 0) {
      console.log(`  failed dates: ${prefetch.failed.join(", ")}`);
    }

    // 2) Re-run FIFO with dated FX now cached in the DB.
    const binanceWithdrawals: ExchangeWithdrawalRow[] = [];
    if (withdrawCsv.trim()) {
      const preview = previewBinanceImport(db, withdrawCsv, "withdraw", {
        spotCsv: spotCsv || undefined,
        convertCsv: convertCsv || undefined,
        autoInvestCsv: autoCsv || undefined,
      });
      binanceWithdrawals.push(...(preview.withdrawals ?? []));
      if (preview.errors.length > 0) {
        console.log(
          `Binance withdraw preview: ${preview.errors.length} note(s) (see FIFO applied/skip log)`,
        );
      }
    }

    let cdcWithdrawals: ExchangeWithdrawalRow[] = [];
    if (cdcCsv.trim()) {
      const preview = previewCryptoComImport(db, cdcCsv);
      cdcWithdrawals = preview.withdrawals;
      if (preview.errors.length > 0) {
        console.log(
          `CDC (combined ${args.cdc.length} file(s)) preview: ${preview.errors.length} note(s)`,
        );
      }
    }

    const merged = mergeWithdrawals(binanceWithdrawals, cdcWithdrawals);

    // 3) Dry-run summary: per-tx proposed status/basis vs current.
    const existingByHash = transfersByTxHash(db);
    console.log(`\nProposed withdrawal costs (${merged.length} total):`);
    for (const w of merged) {
      const existing = existingByHash.get(w.txHash.toLowerCase());
      const before =
        existing?.costBasis != null
          ? `${existing.costStatus} ${existing.costBasis.toFixed(2)} ${existing.costCurrency ?? ""}`
          : `${existing?.costStatus ?? "missing"} —`;
      const after =
        w.costBasis != null
          ? `${w.costStatus} ${w.costBasis.toFixed(2)} ${w.costCurrency ?? ""}`
          : `${w.costStatus ?? "unknown"} —`;
      console.log(
        `  ${w.chain}:${w.txHash.slice(0, 12)}… ${w.asset} amt=${w.amount} | before: ${before} | after: ${after}`,
      );
    }

    // 4) Sanity gate — must pass BEFORE apply is allowed.
    const gate = inspectGateTx(db, merged);
    console.log("\nSanity gate (ETH tx 0xabc4467c…):");
    console.log(`  tx_hash: ${gate.txHash ?? "NOT FOUND IN DB"}`);
    console.log(`  current status: ${gate.currentStatus ?? "n/a"}`);
    console.log(
      `  current: ${gate.currentEurPerUnit != null ? gate.currentEurPerUnit.toFixed(4) : "n/a"} EUR/unit`,
    );
    console.log(
      `  proposed: ${gate.proposedEurPerUnit != null ? gate.proposedEurPerUnit.toFixed(4) : "n/a"} EUR/unit (${gate.proposedStatus ?? "n/a"})`,
    );

    const gatePasses =
      gate.txHash != null &&
      gate.currentStatus !== "gift" &&
      gate.proposedEurPerUnit != null &&
      gate.proposedEurPerUnit >= GATE_MIN_EUR_PER_UNIT;

    if (!gatePasses) {
      const reason =
        gate.txHash == null
          ? "tx not found in DB"
          : gate.currentStatus === "gift"
            ? "existing row is marked gift"
            : `proposed cost/unit must be >= ${GATE_MIN_EUR_PER_UNIT} EUR`;
      console.error(
        `\nGATE FAILED (${reason}) for ${GATE_TX_HASH_PREFIX}…. Refusing --apply.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log("\nGate PASSED.");

    if (!args.apply) {
      console.log("\nDry-run complete. Re-run with --apply to persist.");
      return;
    }

    const result = applyWithdrawalCostsSkippingGift(db, merged);
    console.log("\nAPPLY", JSON.stringify(result));

    // Re-read from DB (not memory) to confirm the write actually landed.
    const postApply = verifyGateAfterApply(db);
    console.log(
      `Gate tx after apply: ${postApply.eurPerUnit != null ? postApply.eurPerUnit.toFixed(4) : "n/a"} EUR/unit (status=${postApply.status ?? "n/a"})`,
    );
    if (!postApply.ok) {
      console.error(
        `\nPOST-APPLY GATE FAILED: ${GATE_TX_HASH_PREFIX}… did not land >= ${GATE_MIN_EUR_PER_UNIT} EUR/unit as non-gift after apply.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log("Post-apply gate PASSED.");
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
