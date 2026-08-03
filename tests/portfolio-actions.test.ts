import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  valuePortfolio: vi.fn().mockResolvedValue(undefined),
  updateManualValue: vi.fn().mockReturnValue({ id: "manual-1" }),
  deleteHolding: vi.fn(),
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

vi.mock("@/lib/portfolio/page-data", () => ({
  loadDashboardPageData: vi.fn().mockResolvedValue({
    valuation: {
      baseCurrency: "EUR",
      totalBase: 0,
      totalCostBase: 0,
      unrealizedPlBase: 0,
      holdings: [],
      pricesOutdated: false,
      asOf: "2026-07-25T10:00:00.000Z",
    },
    snapshots: [],
    profitLossPct: null,
  }),
  loadHoldingsPageData: vi.fn().mockResolvedValue({
    valuation: {
      baseCurrency: "EUR",
      totalBase: 0,
      totalCostBase: 0,
      unrealizedPlBase: 0,
      holdings: [],
      pricesOutdated: false,
      asOf: "2026-07-25T10:00:00.000Z",
    },
    lotsByHolding: {},
  }),
}));

vi.mock("@/lib/holdings-repo", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/holdings-repo")>();
  return {
    ...actual,
    updateManualValue: mocks.updateManualValue,
    deleteHolding: mocks.deleteHolding,
  };
});

import {
  addCryptoHolding,
  addManualHolding,
  deleteHoldingAction,
  forceRefreshPortfolio,
  updateManualValueAction,
} from "@/app/actions/portfolio";

describe("portfolio form actions", () => {
  beforeEach(() => {
    mocks.revalidatePath.mockClear();
    mocks.valuePortfolio.mockClear();
    mocks.updateManualValue.mockClear();
    mocks.deleteHolding.mockClear();
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

  it("updates a manual holding's value from form data", async () => {
    const formData = new FormData();
    formData.set("holdingId", "manual-1");
    formData.set("manualValue", "1750.5");

    await updateManualValueAction(formData);

    expect(mocks.updateManualValue).toHaveBeenCalledWith(
      expect.anything(),
      "manual-1",
      1750.5,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/holdings");
  });

  it("rejects a non-numeric manual value", async () => {
    const formData = new FormData();
    formData.set("holdingId", "manual-1");
    formData.set("manualValue", "not-a-number");

    await expect(updateManualValueAction(formData)).rejects.toThrow(
      "manualValue must be a number",
    );
    expect(mocks.updateManualValue).not.toHaveBeenCalled();
  });

  it("deletes a holding by id from form data", async () => {
    const formData = new FormData();
    formData.set("holdingId", "holding-1");

    await deleteHoldingAction(formData);

    expect(mocks.deleteHolding).toHaveBeenCalledWith(
      expect.anything(),
      "holding-1",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/holdings");
  });
});
