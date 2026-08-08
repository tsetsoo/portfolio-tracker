/**
 * Restore wallets from wallets-restore.json, then scan + refresh balances.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/restore-wallets.ts \
 *     --db .tmp-reimport/portfolio.cost-verify.db \
 *     --from .tmp-reimport/wallets-restore.json \
 *     [--scan]
 */
import { readFileSync } from "node:fs";

import Database from "better-sqlite3";

import { migrate } from "../lib/db/migrate";
import {
  addBchAddress,
  createManualWallet,
  listWallets,
  listWalletTransfers,
  setBtcXpubWallet,
} from "../lib/wallets/repo";
import {
  refreshWalletBalances,
  scanWalletWithdrawals,
} from "../lib/wallets/sync";
import type { BtcScriptType } from "../lib/wallets/xpub";

type RestoreFile = {
  eth?: Array<{ address: string; label?: string | null }>;
  btc?: Array<{
    xpub: string;
    scriptType?: BtcScriptType | null;
    label?: string | null;
  }>;
  bch?: string[];
};

function parseArgs(argv: string[]) {
  const args = { db: "", from: "", scan: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value after ${a}`);
      return v;
    };
    if (a === "--db") args.db = next();
    else if (a === "--from") args.from = next();
    else if (a === "--scan") args.scan = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!args.db) throw new Error("--db is required");
  if (!args.from) throw new Error("--from is required");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const restore = JSON.parse(readFileSync(args.from, "utf8")) as RestoreFile;
  const db = new Database(args.db);
  db.pragma("foreign_keys = ON");
  migrate(db);

  for (const eth of restore.eth ?? []) {
    createManualWallet(db, "eth", eth.address, eth.label ?? null);
  }
  for (const btc of restore.btc ?? []) {
    setBtcXpubWallet(
      db,
      btc.xpub,
      btc.label ?? null,
      btc.scriptType ?? "p2wpkh",
    );
  }
  for (const addr of restore.bch ?? []) {
    addBchAddress(db, addr, null);
  }

  console.log(
    "wallets",
    listWallets(db).map((w) => ({
      chain: w.chain,
      address: w.address,
      label: w.label,
      addrs: w.addresses.length,
    })),
  );
  console.log("transfers", listWalletTransfers(db).length);

  if (args.scan) {
    const scan = await scanWalletWithdrawals(db);
    console.log("scan", scan);
    const refreshed = await refreshWalletBalances(db);
    console.log("refreshed", refreshed);
    console.log(
      "balances",
      listWallets(db).map((w) => ({
        chain: w.chain,
        balance: w.balance,
        asset: w.balanceAsset,
        label: w.label,
      })),
    );
  }

  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
