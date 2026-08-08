import { execFileSync } from "node:child_process";

import Database from "better-sqlite3";

import { migrate } from "../lib/db/migrate";
import { fetchBtcBalance } from "../lib/wallets/btc";
import {
  listAddressesForWallet,
  listWallets,
  updateAddressBalance,
  updateWalletBalance,
} from "../lib/wallets/repo";

/** Node undici often ETIMEDOUT to explorers; curl works on this host. */
const curlFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    throw new Error(`curlFetch only supports GET (got ${method})`);
  }
  const body = execFileSync(
    "curl",
    ["-sS", "--connect-timeout", "15", "--max-time", "30", url],
    { encoding: "utf8" },
  );
  return new Response(body, { status: 200 });
};

async function main() {
  const dbPath = process.argv[2] ?? ".tmp-reimport/portfolio.cost-verify.db";
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  migrate(db);

  const wallet = listWallets(db).find((w) => w.chain === "btc");
  if (!wallet) throw new Error("No BTC wallet");

  const addresses = listAddressesForWallet(db, wallet.id);
  let total = 0;
  let errors = 0;
  const funded: Array<{ address: string; balance: number }> = [];

  for (const address of addresses) {
    try {
      const balance = await fetchBtcBalance(address, {
        fetchImpl: curlFetch,
        throttleMs: 200,
        baseUrl: "https://blockstream.info/api",
      });
      updateAddressBalance(db, wallet.id, address, balance);
      total += balance;
      if (balance > 0) funded.push({ address, balance });
    } catch (error) {
      errors += 1;
      if (errors <= 5) {
        console.error(
          "fail",
          address,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  updateWalletBalance(db, wallet.id, total, "BTC", new Date().toISOString());
  console.log(
    JSON.stringify(
      { total, errors, fundedCount: funded.length, funded },
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
