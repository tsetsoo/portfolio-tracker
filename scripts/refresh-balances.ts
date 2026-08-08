import Database from "better-sqlite3";

import { migrate } from "../lib/db/migrate";
import { listTokenBalancesForWallet, listWallets } from "../lib/wallets/repo";
import { refreshWalletBalances } from "../lib/wallets/sync";

async function main() {
  const dbPath = process.argv[2] ?? ".tmp-reimport/portfolio.cost-verify.db";
  const chainFilter = process.argv[3]; // optional: btc|eth|bch
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  migrate(db);

  const wallets = listWallets(db).filter((w) =>
    chainFilter ? w.chain === chainFilter : true,
  );
  const n = await refreshWalletBalances(db, {
    walletIds: wallets.map((w) => w.id),
  });
  console.log(
    JSON.stringify(
      {
        refreshed: n,
        balances: listWallets(db).map((w) => ({
          chain: w.chain,
          balance: w.balance,
          asset: w.balanceAsset,
          label: w.label,
          tokens: listTokenBalancesForWallet(db, w.id),
        })),
      },
      null,
      2,
    ),
  );
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
