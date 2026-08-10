import crypto from "node:crypto";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "@/lib/db/migrate";
import {
  applyWithdrawalCostsSkippingGift,
  listWalletTransfers,
} from "@/lib/wallets/repo";
import type { TransferCostStatus } from "@/lib/wallets/types";

/** Second ETH gift — must never be overwritten by cost repair. */
const SECOND_ETH_GIFT_TX =
  "0x62dcc94a7260f0d7daf555e06dd4341255d7d9fb46e3f49e79467d9dccd3662a";

const PARTIAL_ETH_TX =
  "0xabc1111111111111111111111111111111111111111111111111111111111111";

function insertTransfer(
  db: Database.Database,
  row: {
    txHash: string;
    costStatus: TransferCostStatus;
    costBasis?: number | null;
    costCurrency?: string | null;
    costNotes?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO wallet_transfers
       (id, wallet_id, chain, asset, amount, tx_hash, transferred_at, source,
        import_batch_id, onchain_amount, onchain_status, notes,
        cost_basis, cost_currency, cost_status, cost_notes)
     VALUES (?, NULL, 'eth', 'ETH', ?, ?, '2021-12-15', 'cryptocom',
             NULL, NULL, 'pending', NULL, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    row.txHash === SECOND_ETH_GIFT_TX ? 0.70457591 : 0.5,
    row.txHash,
    row.costBasis ?? null,
    row.costCurrency ?? null,
    row.costStatus,
    row.costNotes ?? null,
  );
}

describe("applyWithdrawalCostsSkippingGift", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("updates partial transfers but leaves gift transfers unchanged", () => {
    insertTransfer(db, {
      txHash: SECOND_ETH_GIFT_TX,
      costStatus: "gift",
      costBasis: null,
      costNotes: "Marked as gift / unknown source",
    });
    insertTransfer(db, {
      txHash: PARTIAL_ETH_TX,
      costStatus: "partial",
      costBasis: 100,
      costCurrency: "EUR",
      costNotes: "Mixed lot currencies; some FX rates missing",
    });

    const result = applyWithdrawalCostsSkippingGift(db, [
      {
        chain: "eth",
        asset: "ETH",
        amount: 0.70457591,
        txHash: SECOND_ETH_GIFT_TX,
        transferredAt: "2021-12-15",
        costBasis: 9999,
        costCurrency: "EUR",
        costStatus: "costed",
      },
      {
        chain: "eth",
        asset: "ETH",
        amount: 0.5,
        txHash: PARTIAL_ETH_TX,
        transferredAt: "2025-03-02",
        costBasis: 850,
        costCurrency: "EUR",
        costStatus: "costed",
        costNotes: "FIFO cost from exchange lots",
      },
      {
        chain: "eth",
        asset: "ETH",
        amount: 1,
        txHash: "0xmissing000000000000000000000000000000000000000000000000000000000",
        transferredAt: "2025-03-02",
        costBasis: 100,
        costCurrency: "EUR",
        costStatus: "costed",
      },
    ]);

    expect(result).toEqual({ updated: 1, skippedGift: 1, unmatched: 1 });

    const byHash = new Map(
      listWalletTransfers(db).map((row) => [row.txHash, row]),
    );

    expect(byHash.get(SECOND_ETH_GIFT_TX)).toMatchObject({
      costStatus: "gift",
      costBasis: null,
      costNotes: "Marked as gift / unknown source",
    });
    expect(byHash.get(PARTIAL_ETH_TX)).toMatchObject({
      costStatus: "costed",
      costBasis: 850,
      costCurrency: "EUR",
      costNotes: "FIFO cost from exchange lots",
    });
  });

  it("skips withdrawals without cost basis or status", () => {
    insertTransfer(db, {
      txHash: PARTIAL_ETH_TX,
      costStatus: "unknown",
    });

    const result = applyWithdrawalCostsSkippingGift(db, [
      {
        chain: "eth",
        asset: "ETH",
        amount: 0.5,
        txHash: PARTIAL_ETH_TX,
        transferredAt: "2025-03-02",
      },
    ]);

    expect(result).toEqual({ updated: 0, skippedGift: 0, unmatched: 0 });
    expect(listWalletTransfers(db)[0]).toMatchObject({
      costStatus: "unknown",
      costBasis: null,
    });
  });
});
