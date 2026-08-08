import { describe, expect, it, vi } from "vitest";

import {
  guessExchangeVenue,
  orphanSearchHint,
} from "@/lib/wallets/exchange-senders";
import { findOrphanInflows } from "@/lib/wallets/orphans";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/migrate";
import {
  createManualWallet,
  listWalletTransfers,
  markOrphanInflowAsGift,
} from "@/lib/wallets/repo";
import { costCoverageRatio } from "@/lib/wallets/cost-coverage";

describe("orphan inflow helpers", () => {
  it("recognizes a known Binance BTC hot wallet", () => {
    expect(
      guessExchangeVenue(
        "btc",
        "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
      ),
    ).toBe("binance");
    expect(orphanSearchHint({
      venue: "binance",
      asset: "BTC",
      amount: 0.1,
      transferredAt: "2022-08-20",
    })).toMatch(/Binance/);
  });

  it("flags inbound ETH not present in wallet_transfers", async () => {
    const db = new Database(":memory:");
    migrate(db);
    createManualWallet(
      db,
      "eth",
      "0x4c4c8cedac466aeb876667f6debcaba15d3ebe3e",
    );

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("blockscout") || url.includes("txlist")) {
        return Response.json({
          status: "1",
          result: [
            {
              hash: "0xorphaneth111111111111111111111111111111111111111111111111111111",
              from: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
              to: "0x4c4c8cedac466aeb876667f6debcaba15d3ebe3e",
              value: "1000000000000000000",
              timeStamp: "1620000000",
              isError: "0",
            },
          ],
        });
      }
      return Response.json([]);
    });

    const orphans = await findOrphanInflows(db, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      chain: "eth",
      asset: "ETH",
      amount: 1,
      guessedVenue: "unknown",
    });
    expect(orphans[0]!.searchHint).toMatch(/withdrawal history/i);
    db.close();
  });

  it("marks an orphan inflow as a manual gift transfer covering the wallet", () => {
    const db = new Database(":memory:");
    migrate(db);
    const wallet = createManualWallet(
      db,
      "eth",
      "0xc3c4c2e412f3ccf3bf5ccf798a7af9fe5ca47b06",
      "Second",
    );
    db.prepare(
      `UPDATE wallets SET balance = ?, balance_asset = ? WHERE id = ?`,
    ).run(0.70457591, "ETH", wallet.id);

    const transfer = markOrphanInflowAsGift(db, {
      chain: "eth",
      asset: "ETH",
      amount: 0.70457591,
      txHash:
        "0x62dcc94a7260f0d7daf555e06dd4341255d7d9fb46e3f49e79467d9dccd3662a",
      transferredAt: "2021-12-15",
      toAddress: "0xc3c4c2e412f3ccf3bf5ccf798a7af9fe5ca47b06",
    });

    expect(transfer).toMatchObject({
      walletId: wallet.id,
      source: "manual",
      costStatus: "gift",
      onchainStatus: "matched",
      costBasis: null,
    });
    const listed = listWalletTransfers(db, wallet.id);
    expect(listed).toHaveLength(1);
    expect(costCoverageRatio(0.70457591, listed, "ETH")).toBe(1);
    db.close();
  });
});
