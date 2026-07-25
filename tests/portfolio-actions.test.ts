import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  valuePortfolio: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/portfolio/value-portfolio", () => ({
  valuePortfolio: mocks.valuePortfolio,
}));

import {
  addCryptoHolding,
  addManualHolding,
  forceRefreshPortfolio,
} from "@/app/actions/portfolio";

describe("portfolio form actions", () => {
  beforeEach(() => {
    mocks.revalidatePath.mockClear();
    mocks.valuePortfolio.mockClear();
  });

  it("rejects malformed crypto and manual currency codes", async () => {
    const crypto = new FormData();
    crypto.set("symbol", "BTC");
    crypto.set("quantity", "1");
    crypto.set("costPerUnit", "50000");
    crypto.set("costCurrency", "US");
    crypto.set("purchasedAt", "2026-07-25");

    const manual = new FormData();
    manual.set("name", "Cash");
    manual.set("manualValue", "100");
    manual.set("currency", "12$");

    await expect(addCryptoHolding(crypto)).rejects.toThrow(
      "Currency code must be three letters",
    );
    await expect(addManualHolding(manual)).rejects.toThrow(
      "Currency code must be three letters",
    );
  });

  it("revalidates holdings after forced price refresh", async () => {
    await forceRefreshPortfolio();

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/holdings");
  });
});
