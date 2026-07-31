import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrate } from "@/lib/db/migrate";
import {
  attachBtcAddress,
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

  it("auto-discovers BTC outputs and combines receive addresses into one wallet", async () => {
    upsertWalletTransfersFromWithdrawals(db, [
      {
        chain: "btc",
        asset: "BTC",
        amount: 0.01,
        txHash:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        transferredAt: "2025-03-01",
      },
      {
        chain: "btc",
        asset: "BTC",
        amount: 0.02,
        txHash:
          "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        transferredAt: "2025-03-02",
      },
    ]);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tx/bbbb")) {
        return Response.json({
          vout: [
            { scriptpubkey_address: "bc1qaaa", value: 960_000 },
            { scriptpubkey_address: "bc1qother", value: 5_000_000 },
          ],
        });
      }
      if (url.includes("/tx/cccc")) {
        return Response.json({
          vout: [{ scriptpubkey_address: "bc1qbbb", value: 1_960_000 }],
        });
      }
      if (url.includes("/address/")) {
        return Response.json({
          chain_stats: { funded_txo_sum: 1_000_000, spent_txo_sum: 0 },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await scanWalletWithdrawals(db, { fetchImpl });
    expect(result).toMatchObject({
      resolved: 2,
      matched: 2,
      walletsTouched: 1,
    });

    const wallets = listWallets(db);
    expect(wallets).toHaveLength(1);
    expect(wallets[0]!.chain).toBe("btc");
    expect(wallets[0]!.addresses.sort()).toEqual(["bc1qaaa", "bc1qbbb"]);
    expect(wallets[0]!.balance).toBe(0.02); // 0.01 + 0.01 per address mock
    expect(listWalletTransfers(db).every((t) => t.walletId === wallets[0]!.id)).toBe(
      true,
    );
  });
});

describe("attachBtcAddress", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("folds later BTC addresses into the first wallet", () => {
    const first = attachBtcAddress(db, "bc1qone");
    const second = attachBtcAddress(db, "bc1qtwo");
    expect(second.id).toBe(first.id);
    expect(listWallets(db)).toHaveLength(1);
    expect(listWallets(db)[0]!.addresses.sort()).toEqual(["bc1qone", "bc1qtwo"]);
  });
});
