/**
 * Upsert Crypto.com withdrawal tx hashes into wallet_transfers and optionally scan.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/seed-wallets-from-cdc.ts \
 *     --db /path/to/portfolio.db \
 *     --cdc /path/to/cdc1.csv --cdc /path/to/cdc2.csv \
 *     [--scan]
 */
import { readFileSync } from "node:fs";

import Database from "better-sqlite3";

import { extractCryptoComWithdrawals } from "../lib/cryptocom/withdrawals";
import { migrate } from "../lib/db/migrate";
import { combineCsvTexts } from "../lib/import/combine-csv";
import {
  listPendingTransfers,
  listWallets,
  upsertWalletTransfersFromWithdrawals,
} from "../lib/wallets/repo";
import { scanWalletWithdrawals } from "../lib/wallets/sync";

function parseArgs(argv: string[]) {
  const args = { db: "", cdc: [] as string[], scan: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value after ${a}`);
      return v;
    };
    if (a === "--db") args.db = next();
    else if (a === "--cdc") args.cdc.push(next());
    else if (a === "--scan") args.scan = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!args.db) throw new Error("--db is required");
  if (args.cdc.length === 0) throw new Error("--cdc is required");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const texts = args.cdc.map((path) => readFileSync(path, "utf8"));
  const combined = combineCsvTexts(texts);
  const withdrawals = extractCryptoComWithdrawals(combined);

  const db = new Database(args.db);
  db.pragma("foreign_keys = ON");
  migrate(db);

  const { upserted } = upsertWalletTransfersFromWithdrawals(db, withdrawals, {
    source: "cryptocom",
  });
  console.log("withdrawals extracted", withdrawals.length);
  console.log("wallet_transfers upserted", upserted);
  console.log("pending before scan", listPendingTransfers(db).length);

  if (args.scan) {
    const result = await scanWalletWithdrawals(db);
    console.log("scan", result);
    console.log(
      "wallets",
      listWallets(db).map((w) => ({
        chain: w.chain,
        address: w.address,
        balance: w.balance,
      })),
    );
  }

  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
