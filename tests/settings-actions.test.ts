import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  resetPortfolioData: vi.fn().mockReturnValue({
    holdingsDeleted: 1,
    lotsDeleted: 2,
    snapshotsDeleted: 3,
    importBatchesDeleted: 1,
  }),
  setBaseCurrency: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/portfolio/reset", () => ({
  resetPortfolioData: mocks.resetPortfolioData,
}));

vi.mock("@/lib/settings", () => ({
  setBaseCurrency: mocks.setBaseCurrency,
}));

import {
  resetPortfolioAction,
  saveBaseCurrency,
} from "@/app/actions/settings";

describe("settings actions", () => {
  beforeEach(() => {
    mocks.revalidatePath.mockClear();
    mocks.resetPortfolioData.mockClear();
    mocks.setBaseCurrency.mockClear();
  });

  it("saves base currency and revalidates pages", async () => {
    const formData = new FormData();
    formData.set("baseCurrency", "eur");
    await saveBaseCurrency(formData);
    expect(mocks.setBaseCurrency).toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("requires typing RESET before wiping portfolio data", async () => {
    const bad = new FormData();
    bad.set("confirmation", "reset");
    await expect(resetPortfolioAction(bad)).rejects.toThrow(
      "Type RESET to confirm wiping portfolio data",
    );
    expect(mocks.resetPortfolioData).not.toHaveBeenCalled();

    const ok = new FormData();
    ok.set("confirmation", "RESET");
    await resetPortfolioAction(ok);
    expect(mocks.resetPortfolioData).toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/holdings");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/import");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });
});
