import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "@/lib/db/migrate";
import { buildWalletAvgCostReport } from "@/lib/wallets/avg-cost-report";

function insertWallet(
  db: Database.Database,
  id: string,
  chain: "btc" | "eth",
  balance: number,
  balanceAsset: string | null,
): void {
  db.prepare(
    `INSERT INTO wallets
       (id, chain, address, balance, balance_asset, created_at)
     VALUES (?, ?, ?, ?, ?, '2026-08-10')`,
  ).run(id, chain, `${chain}-${id}`, balance, balanceAsset);
}

function insertTransfer(
  db: Database.Database,
  id: string,
  asset: string,
  amount: number,
  costStatus: "costed" | "partial" | "unknown" | "gift",
  costBasis: number | null = null,
  costCurrency: string | null = null,
  costNotes: string | null = null,
): void {
  const chain = asset.toUpperCase() === "BTC" ? "btc" : "eth";
  db.prepare(
    `INSERT INTO wallet_transfers
       (id, chain, asset, amount, tx_hash, transferred_at, source,
        onchain_status, cost_basis, cost_currency, cost_status, cost_notes)
     VALUES (?, ?, ?, ?, ?, '2026-08-10', 'manual',
             'matched', ?, ?, ?, ?)`,
  ).run(
    id,
    chain,
    asset,
    amount,
    `tx-${id}`,
    costBasis,
    costCurrency,
    costStatus,
    costNotes,
  );
}

describe("buildWalletAvgCostReport", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);

    insertWallet(db, "btc-labelled", "btc", 10, "btc");
    insertWallet(db, "btc-legacy", "btc", 2, null);
    insertWallet(db, "eth-labelled", "eth", 8, "ETH");
    insertWallet(db, "eth-other-native", "eth", 99, "USDC");

    db.prepare(
      `INSERT INTO wallet_token_balances
         (wallet_id, asset, balance, updated_at)
       VALUES
         ('eth-labelled', 'LINK', 30, '2026-08-10'),
         ('eth-other-native', 'link', 2, '2026-08-10')`,
    ).run();

    insertTransfer(db, "btc-costed-eur", "BTC", 3, "costed", 30_000, "eur");
    insertTransfer(db, "btc-costed-usd", "btc", 1, "costed", 50_000, "USD");
    insertTransfer(
      db,
      "btc-partial-one",
      "BTC",
      1,
      "partial",
      2_000,
      "EUR",
      "Missing GBP/EUR rate",
    );
    insertTransfer(
      db,
      "btc-partial-two",
      "BTC",
      0.5,
      "partial",
      null,
      null,
      "Missing GBP/EUR rate",
    );
    insertTransfer(db, "btc-gift", "BTC", 2, "gift");
    insertTransfer(db, "btc-recorded-unknown", "BTC", 50, "unknown");

    insertTransfer(db, "eth-costed", "ETH", 2, "costed", 4_000, "EUR");
    insertTransfer(db, "eth-gift", "ETH", 1, "gift");

    insertTransfer(db, "link-costed", "LINK", 10, "costed", 100, "EUR");
    insertTransfer(
      db,
      "link-partial",
      "LINK",
      5,
      "partial",
      25,
      "EUR",
      "Missing acquisition lots",
    );
    insertTransfer(db, "link-gift", "LINK", 2, "gift");
  });

  afterEach(() => {
    db.close();
  });

  it("aggregates native and token balances into tax-ready cost buckets", () => {
    expect(buildWalletAvgCostReport(db)).toEqual([
      {
        asset: "BTC",
        qtyOnChain: 12,
        qtyCosted: 4,
        qtyPartial: 1.5,
        qtyGift: 2,
        qtyUnknown: 4.5,
        costEurCosted: 30_000,
        avgEurTaxReady: 7_500,
        costEurPartial: 2_000,
        partialMissingNotes: ["Missing GBP/EUR rate"],
      },
      {
        asset: "ETH",
        qtyOnChain: 8,
        qtyCosted: 2,
        qtyPartial: 0,
        qtyGift: 1,
        qtyUnknown: 5,
        costEurCosted: 4_000,
        avgEurTaxReady: 2_000,
        costEurPartial: 0,
        partialMissingNotes: [],
      },
      {
        asset: "LINK",
        qtyOnChain: 32,
        qtyCosted: 10,
        qtyPartial: 5,
        qtyGift: 2,
        qtyUnknown: 15,
        costEurCosted: 100,
        avgEurTaxReady: 10,
        costEurPartial: 25,
        partialMissingNotes: ["Missing acquisition lots"],
      },
    ]);
  });

  it("normalizes and filters the requested supported assets", () => {
    expect(buildWalletAvgCostReport(db, [" link ", "DOGE", "btc"])).toEqual([
      expect.objectContaining({ asset: "LINK", qtyOnChain: 32 }),
      expect.objectContaining({ asset: "BTC", qtyOnChain: 12 }),
    ]);
  });
});
