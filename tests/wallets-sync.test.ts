import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrate } from "@/lib/db/migrate";
import {
  listWalletTransfers,
  listWallets,
  upsertWalletTransfersFromWithdrawals,
} from "@/lib/wallets/repo";
import { scanWalletWithdrawals } from "@/lib/wallets/sync";

describe("scanWalletWithdrawals", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("resolves ETH transfer, creates wallet, and marks match status", async () => {
    upsertWalletTransfersFromWithdrawals(db, [
      {
        chain: "eth",
        asset: "ETH",
        amount: 1,
        txHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        transferredAt: "2025-03-01",
      },
    ]);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("publicnode") || url.includes("ankr") || url.includes("1rpc")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
        };
        if (body.method === "eth_getTransactionByHash") {
          return Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: {
              to: "0x1111111111111111111111111111111111111111",
              value: "0xde0b6b3a7640000",
              input: "0x",
            },
          });
        }
        if (body.method === "eth_getBalance") {
          return Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: "0x6f05b59d3b20000", // 0.5 ETH
          });
        }
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await scanWalletWithdrawals(db, { fetchImpl });
    expect(result).toMatchObject({
      resolved: 1,
      matched: 1,
      mismatched: 0,
      unresolved: 0,
      walletsTouched: 1,
    });

    const wallets = listWallets(db);
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({
      chain: "eth",
      address: "0x1111111111111111111111111111111111111111",
      balance: 0.5,
      balanceAsset: "ETH",
    });

    const transfers = listWalletTransfers(db);
    expect(transfers[0]).toMatchObject({
      walletId: wallets[0]!.id,
      onchainAmount: 1,
      onchainStatus: "matched",
    });
  });
});
