import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  commitCryptoComImport,
  previewCryptoComImport,
} from "@/lib/cryptocom/commit";
import { extractCryptoComWithdrawals } from "@/lib/cryptocom/withdrawals";
import { migrate } from "@/lib/db/migrate";
import { listWalletTransfers } from "@/lib/wallets/repo";

const withdrawalsCsv = readFileSync(
  path.join(__dirname, "fixtures", "cryptocom-withdrawals-sample.csv"),
  "utf8",
);

describe("Crypto.com withdrawal persistence", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("extracts ETH/BTC/LINK withdrawals with hashes and skips unsupported chains", () => {
    const rows = extractCryptoComWithdrawals(withdrawalsCsv);
    expect(rows).toEqual([
      {
        chain: "eth",
        asset: "ETH",
        amount: 0.5,
        txHash:
          "0xabc1111111111111111111111111111111111111111111111111111111111111",
        transferredAt: "2025-03-02",
      },
      {
        chain: "btc",
        asset: "BTC",
        amount: 0.01,
        txHash:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        transferredAt: "2025-03-03",
      },
      {
        chain: "eth",
        asset: "LINK",
        amount: 25,
        txHash:
          "0xlink222222222222222222222222222222222222222222222222222222222222",
        transferredAt: "2025-03-04",
      },
    ]);
  });

  it("preview includes withdrawals and commit upserts wallet_transfers", () => {
    const preview = previewCryptoComImport(db, withdrawalsCsv);
    expect(preview.withdrawals).toHaveLength(3);

    const result = commitCryptoComImport(db, preview.toInsert, {
      withdrawals: preview.withdrawals,
      importBatchId: null,
    });
    expect(result.inserted).toBeGreaterThan(0);
    expect(result.withdrawalsUpserted).toBe(3);

    const transfers = listWalletTransfers(db);
    expect(transfers).toHaveLength(3);
    expect(transfers.every((row) => row.onchainStatus === "pending")).toBe(
      true,
    );
    expect(transfers.every((row) => row.source === "cryptocom")).toBe(true);
    expect(
      transfers.map((row) => row.txHash).sort(),
    ).toEqual(
      [
        "0xabc1111111111111111111111111111111111111111111111111111111111111",
        "0xlink222222222222222222222222222222222222222222222222222222222222",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ].sort(),
    );

    const again = commitCryptoComImport(db, [], {
      withdrawals: preview.withdrawals,
    });
    expect(again.withdrawalsUpserted).toBe(3);
    expect(listWalletTransfers(db)).toHaveLength(3);
  });
});
