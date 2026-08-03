import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrate } from "@/lib/db/migrate";
import {
  listWalletTransfers,
  listWallets,
  setBtcXpubWallet,
  upsertWalletTransfersFromWithdrawals,
} from "@/lib/wallets/repo";
import { scanWalletWithdrawals } from "@/lib/wallets/sync";
import { deriveBtcAddress } from "@/lib/wallets/xpub";

const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

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
            result: "0x6f05b59d3b20000",
          });
        }
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await scanWalletWithdrawals(db, { fetchImpl });
    expect(result).toMatchObject({
      resolved: 1,
      matched: 1,
      walletsTouched: 1,
    });
    expect(listWallets(db)[0]).toMatchObject({
      chain: "eth",
      address: "0x1111111111111111111111111111111111111111",
    });
  });

  it("leaves BTC unresolved until an xpub is configured", async () => {
    upsertWalletTransfersFromWithdrawals(db, [
      {
        chain: "btc",
        asset: "BTC",
        amount: 0.01,
        txHash:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        transferredAt: "2025-03-01",
      },
    ]);

    const result = await scanWalletWithdrawals(db, {
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(result.unresolved).toBe(1);
    expect(listWalletTransfers(db)[0]?.onchainStatus).toBe("unresolved");
  });

  it("links BTC withdrawals to addresses derived from the xpub", async () => {
    const receive0 = deriveBtcAddress(ZPUB, false, 0).address;
    setBtcXpubWallet(db, ZPUB, "Ledger");

    upsertWalletTransfersFromWithdrawals(db, [
      {
        chain: "btc",
        asset: "BTC",
        amount: 0.01,
        txHash:
          "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        transferredAt: "2025-03-01",
      },
    ]);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tx/")) {
        return Response.json({
          vout: [
            { scriptpubkey_address: "bc1qother", value: 1_000_000 },
            { scriptpubkey_address: receive0, value: 960_000 },
          ],
        });
      }
      if (url.includes("/address/")) {
        const isReceive0 = url.includes(receive0);
        return Response.json({
          chain_stats: {
            tx_count: isReceive0 ? 1 : 0,
            funded_txo_sum: isReceive0 ? 960_000 : 0,
            spent_txo_sum: 0,
          },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await scanWalletWithdrawals(db, { fetchImpl });
    expect(result).toMatchObject({ resolved: 1, matched: 1, walletsTouched: 1 });
    expect(listWallets(db)).toHaveLength(1);
    expect(listWallets(db)[0]?.xpub).toBe(ZPUB);
    expect(listWalletTransfers(db)[0]).toMatchObject({
      onchainStatus: "matched",
      onchainAmount: 0.0096,
    });
  });
});
