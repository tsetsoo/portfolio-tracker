import { describe, expect, it } from "vitest";

import { formatMoney, formatSignedMoney } from "@/lib/format-money";

describe("formatMoney", () => {
  it("formats ISO currencies with Intl", () => {
    expect(formatMoney(1234.5, "EUR")).toMatch(/1,?234\.50/);
    expect(formatMoney(1234.5, "EUR")).toContain("€");
  });

  it("formats crypto quote codes without throwing", () => {
    expect(formatMoney(85000, "USDT")).toBe("85,000.00 USDT");
    expect(formatMoney(0.8, "USDC")).toBe("0.80 USDC");
  });

  it("formats signed money for crypto quotes", () => {
    expect(formatSignedMoney(12.5, "USDT")).toBe("+12.50 USDT");
    expect(formatSignedMoney(-3, "USDT")).toBe("−3.00 USDT");
  });
});
