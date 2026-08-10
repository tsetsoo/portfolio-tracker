/**
 * Print tax-ready wallet average costs for BTC, ETH, and LINK.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/report-wallet-avg-cost.ts \
 *     --db /path/to/portfolio.db
 */
import Database from "better-sqlite3";

import { migrate } from "../lib/db/migrate";
import { buildWalletAvgCostReport } from "../lib/wallets/avg-cost-report";

type Args = {
  db: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { db: "" };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--db": {
        const value = argv[++i];
        if (!value) throw new Error("Missing value after --db");
        args.db = value;
        break;
      }
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }

  if (!args.db) throw new Error("--db is required");
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(args.db);

  try {
    db.pragma("foreign_keys = ON");
    migrate(db);
    const report = buildWalletAvgCostReport(db);

    console.table(
      report.map((row) => ({
        Asset: row.asset,
        "On-chain qty": row.qtyOnChain,
        "Costed qty (all ccy)": row.qtyCosted,
        "Tax-ready qty (EUR)": row.qtyCostedEur,
        "Partial qty": row.qtyPartial,
        "Gift qty": row.qtyGift,
        "Unknown qty": row.qtyUnknown,
        "Tax-ready cost EUR": row.costEurCosted,
        "Avg EUR": row.avgEurTaxReady,
        "Partial cost EUR": row.costEurPartial,
        "Partial missing notes": row.partialMissingNotes.join("; "),
      })),
    );
  } finally {
    db.close();
  }
}

main();
