import { describe, expect, it, vi } from "vitest";

import { pickClosestBtcOutput, resolveBtcTransaction } from "@/lib/wallets/btc";

describe("pickClosestBtcOutput", () => {
  it("picks the closest vout and marks weak / mismatch by sats delta", () => {
    const matched = pickClosestBtcOutput(0.01, [
      { address: "bc1qmatch", valueSats: 1_000_000 },
      { address: "bc1qother", valueSats: 500_000 },
    ]);
    expect(matched).toMatchObject({
      address: "bc1qmatch",
      confidence: "matched",
      deltaSats: 0,
    });

    const weak = pickClosestBtcOutput(0.01, [
      { address: "bc1qweak", valueSats: 850_000 },
    ]);
    expect(weak?.confidence).toBe("weak");

    const mismatch = pickClosestBtcOutput(0.01, [
      { address: "bc1qfar", valueSats: 100_000 },
    ]);
    expect(mismatch?.confidence).toBe("mismatch");
  });
});

describe("resolveBtcTransaction", () => {
  it("loads mempool.space outputs and selects closest receive", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        vout: [
          { scriptpubkey_address: "bc1qa", value: 200_000 },
          { scriptpubkey_address: "bc1qb", value: 995_000 },
        ],
      }),
    ) as unknown as typeof fetch;

    const resolved = await resolveBtcTransaction(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      0.01,
      { fetchImpl, baseUrl: "https://mempool.test/api" },
    );

    expect(resolved).toMatchObject({
      address: "bc1qb",
      amount: 0.00995,
      confidence: "matched",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://mempool.test/api/tx/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("only considers outputs to known addresses in batch txs", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        vout: [
          { scriptpubkey_address: "bc1qother", value: 1_000_000 },
          { scriptpubkey_address: "bc1qmine", value: 950_000 },
        ],
      }),
    ) as unknown as typeof fetch;

    const resolved = await resolveBtcTransaction("bbbb", 0.01, {
      fetchImpl,
      baseUrl: "https://mempool.test/api",
      knownAddresses: ["bc1qmine"],
    });

    expect(resolved).toMatchObject({
      address: "bc1qmine",
      amount: 0.0095,
      confidence: "matched",
    });

    const missing = await resolveBtcTransaction("bbbb", 0.01, {
      fetchImpl,
      baseUrl: "https://mempool.test/api",
      knownAddresses: ["bc1qunknown"],
    });
    expect(missing).toBeNull();
  });
});
