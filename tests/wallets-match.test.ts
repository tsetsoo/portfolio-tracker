import { describe, expect, it } from "vitest";

import { classifyAmountMatch } from "@/lib/wallets/match";

describe("classifyAmountMatch", () => {
  it("matches ETH within small fee tolerance", () => {
    expect(classifyAmountMatch("eth", 1.0, 0.995)).toMatchObject({
      status: "matched",
    });
    expect(classifyAmountMatch("eth", 1.0, 0.98).status).toBe("mismatch");
  });

  it("classifies BTC fee windows as matched / weak / mismatch", () => {
    expect(classifyAmountMatch("btc", 0.01, 0.0095)).toMatchObject({
      status: "matched",
    });
    expect(classifyAmountMatch("btc", 0.01, 0.0085)).toMatchObject({
      status: "weak",
    });
    expect(classifyAmountMatch("btc", 0.01, 0.005).status).toBe("mismatch");
  });
});
