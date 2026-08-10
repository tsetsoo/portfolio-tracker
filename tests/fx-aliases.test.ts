import { describe, expect, it } from "vitest";
import { normalizeFxCurrency } from "@/lib/quotes/fx-aliases";

describe("normalizeFxCurrency", () => {
  it("aliases stablecoins to USD and uppercases", () => {
    expect(normalizeFxCurrency("usdt")).toBe("USD");
    expect(normalizeFxCurrency("USDC")).toBe("USD");
    expect(normalizeFxCurrency("BUSD")).toBe("USD");
    expect(normalizeFxCurrency("eur")).toBe("EUR");
  });
});
