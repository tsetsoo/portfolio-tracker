import { describe, expect, it, vi } from "vitest";

import {
  guessExchangeVenue,
  orphanSearchHint,
} from "@/lib/wallets/exchange-senders";
import { findOrphanInflows } from "@/lib/wallets/orphans";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/migrate";
import { createManualWallet } from "@/lib/wallets/repo";

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
});
