import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "@/lib/db/migrate";
import {
  listWalletAssetQuantities,
  walletAssetCost,
} from "@/lib/wallets/portfolio-assets";

describe("wallet portfolio assets", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("aggregates native and token balances by asset", () => {
    db.prepare(
      `INSERT INTO wallets
         (id, chain, address, balance, balance_asset, created_at)
       VALUES
         ('btc-1', 'btc', 'bc1a', 1.5, 'BTC', '2026-08-10'),
         ('eth-1', 'eth', '0x1', 2, 'ETH', '2026-08-10'),
         ('eth-2', 'eth', '0x2', 10, 'USDC', '2026-08-10')`,
    ).run();
    db.prepare(
      `INSERT INTO wallet_token_balances
         (wallet_id, asset, balance, updated_at)
       VALUES
         ('eth-1', 'LINK', 5, '2026-08-10'),
         ('eth-2', 'link', 1, '2026-08-10')`,
    ).run();

    expect(listWalletAssetQuantities(db)).toEqual([
      { asset: "BTC", quantity: 1.5 },
      { asset: "ETH", quantity: 2 },
      { asset: "LINK", quantity: 6 },
      { asset: "USDC", quantity: 10 },
    ]);
  });

  it("marks cost complete only when fully covered by EUR-costed + gifts", () => {
    db.prepare(
      `INSERT INTO wallets
         (id, chain, address, balance, balance_asset, created_at)
       VALUES ('eth-1', 'eth', '0x1', 3, 'ETH', '2026-08-10')`,
    ).run();
    db.prepare(
      `INSERT INTO wallet_transfers
         (id, chain, asset, amount, tx_hash, transferred_at, source,
          onchain_status, cost_basis, cost_currency, cost_status)
       VALUES
         ('t1', 'eth', 'ETH', 2, 'tx1', '2026-08-01', 'manual',
          'matched', 4000, 'EUR', 'costed'),
         ('t2', 'eth', 'ETH', 1, 'tx2', '2026-08-02', 'manual',
          'matched', NULL, NULL, 'gift')`,
    ).run();

    expect(walletAssetCost(db, "ETH", 3)).toEqual({
      asset: "ETH",
      complete: true,
      costBasisEur: 4000,
      avgCostPerUnitEur: 4000 / 3,
    });
  });

  it("leaves cost incomplete when unknown remainder exists", () => {
    expect(walletAssetCost(db, "BTC", 10)).toMatchObject({
      complete: false,
      costBasisEur: null,
    });
  });
});
