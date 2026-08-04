import { describe, expect, it, vi } from "vitest";

import {
  fetchBchBalance,
  isValidBchAddress,
  normalizeBchAddress,
} from "@/lib/wallets/bch";

describe("BCH address helpers", () => {
  it("normalizes cashaddr with and without prefix", () => {
    const bare =
      "qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a";
    expect(normalizeBchAddress(bare)).toBe(`bitcoincash:${bare}`);
    expect(normalizeBchAddress(`bitcoincash:${bare}`)).toBe(
      `bitcoincash:${bare}`,
    );
    expect(isValidBchAddress(bare)).toBe(true);
    expect(isValidBchAddress("0xdead")).toBe(false);
  });

  it("fetches balance in BCH from Haskoin", async () => {
    const address = "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a";
    const fetchImpl = vi.fn(async () =>
      Response.json({
        confirmed: 12_500_000,
        unconfirmed: 0,
      }),
    );

    await expect(
      fetchBchBalance(address, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBe(0.125);
  });
});

