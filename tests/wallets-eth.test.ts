import { describe, expect, it, vi } from "vitest";

import { resolveEthTransaction } from "@/lib/wallets/eth";

function rpcFetch(result: unknown): typeof fetch {
  return vi.fn(async () =>
    Response.json({ jsonrpc: "2.0", id: 1, result }),
  ) as unknown as typeof fetch;
}

describe("resolveEthTransaction", () => {
  it("decodes native ETH transfers from value + to", async () => {
    const resolved = await resolveEthTransaction(
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      {
        fetchImpl: rpcFetch({
          to: "0x4c4c8C4C4C4C4C4C4C4C4C4C4C4C4C4C4C4C4C4C",
          value: "0xde0b6b3a7640000", // 1 ETH
          input: "0x",
        }),
        rpcUrls: ["https://example.invalid"],
      },
    );

    expect(resolved).toEqual({
      address: "0x4c4c8c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c",
      amount: 1,
      asset: "ETH",
    });
  });

  it("decodes ERC-20 LINK transfer recipient and amount", async () => {
    const recipient = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const amountHex = (BigInt(25) * BigInt(10) ** BigInt(18))
      .toString(16)
      .padStart(64, "0");
    const input = `0xa9059cbb${recipient.padStart(64, "0")}${amountHex}`;

    const resolved = await resolveEthTransaction("0xlinktx", {
      fetchImpl: rpcFetch({
        to: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
        value: "0x0",
        input,
      }),
      rpcUrls: ["https://example.invalid"],
      expectedAsset: "LINK",
    });

    expect(resolved).toEqual({
      address: `0x${recipient}`,
      amount: 25,
      asset: "LINK",
    });
  });

  it("returns null when the transaction is missing", async () => {
    const resolved = await resolveEthTransaction("0xmissing", {
      fetchImpl: rpcFetch(null),
      rpcUrls: ["https://example.invalid"],
    });
    expect(resolved).toBeNull();
  });
});
