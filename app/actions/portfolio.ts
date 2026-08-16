"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/lib/db/client";
import type { Holding, Lot } from "@/lib/domain/types";
import {
  addLot as addLotToRepo,
  createHolding as createHoldingInRepo,
  deleteHolding as deleteHoldingFromRepo,
  updateManualValue as updateManualValueInRepo,
} from "@/lib/holdings-repo";
import {
  loadDashboardPageData,
  loadHoldingsPageData,
  type DashboardPageData,
  type HoldingsPageData,
} from "@/lib/portfolio/page-data";

import { valueOverviewPortfolio } from "@/lib/portfolio/value-portfolio";
import type {
  CreateHoldingInput,
  CreateLotInput,
} from "@/lib/holdings-repo";
import { normalizeCurrencyCode } from "@/lib/settings";

// No type re-exports here. A "use server" module may only export async
// functions: turbopack compiles every export as a value, so re-exporting a
// type throws "X is not defined" on render. Consumers import DashboardPageData
// and HoldingsPageData straight from @/lib/portfolio/page-data instead.

export async function loadDashboardData(input?: {
  cacheOnly?: boolean;
}): Promise<DashboardPageData> {
  return loadDashboardPageData(getDb(), {
    cacheOnly: input?.cacheOnly === true,
  });
}

export async function loadHoldingsData(): Promise<HoldingsPageData> {
  return loadHoldingsPageData(getDb());
}

export async function createHolding(
  input: CreateHoldingInput,
): Promise<Holding> {
  const holding = createHoldingInRepo(getDb(), input);
  revalidatePath("/");
  revalidatePath("/holdings");
  return holding;
}

export async function addLot(
  holdingId: string,
  input: CreateLotInput,
): Promise<Lot> {
  const lot = addLotToRepo(getDb(), holdingId, input);
  revalidatePath("/");
  revalidatePath("/holdings");
  return lot;
}

export async function updateManualValue(
  holdingId: string,
  value: number,
): Promise<Holding> {
  const holding = updateManualValueInRepo(getDb(), holdingId, value);
  revalidatePath("/");
  revalidatePath("/holdings");
  return holding;
}

export async function deleteHolding(holdingId: string): Promise<void> {
  if (
    holdingId.startsWith("wallet:") ||
    holdingId.startsWith("handpicked:")
  ) {
    throw new Error("Cannot delete a derived wallet or handpicked position");
  }
  deleteHoldingFromRepo(getDb(), holdingId);
  revalidatePath("/");
  revalidatePath("/holdings");
}

export async function forceRefreshPortfolio(): Promise<void> {
  await valueOverviewPortfolio(getDb(), { forceRefresh: true });
  revalidatePath("/");
  revalidatePath("/holdings");
}

function requiredText(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function requiredNumber(formData: FormData, name: string): number {
  const value = Number(requiredText(formData, name));
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

export async function updateManualValueAction(
  formData: FormData,
): Promise<void> {
  const holdingId = requiredText(formData, "holdingId");
  const value = requiredNumber(formData, "manualValue");
  await updateManualValue(holdingId, value);
}

export async function deleteHoldingAction(formData: FormData): Promise<void> {
  const holdingId = requiredText(formData, "holdingId");
  await deleteHolding(holdingId);
}

function positiveNumber(formData: FormData, name: string): number {
  const value = Number(requiredText(formData, name));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be greater than zero`);
  }
  return value;
}

export async function addCryptoHolding(formData: FormData): Promise<void> {
  const symbol = requiredText(formData, "symbol").toUpperCase();
  const costCurrency = normalizeCurrencyCode(
    requiredText(formData, "costCurrency"),
  );

  await createHolding({
    type: "crypto",
    symbol,
    name: symbol,
    quoteCurrency: costCurrency,
    lot: {
      quantity: positiveNumber(formData, "quantity"),
      costPerUnit: positiveNumber(formData, "costPerUnit"),
      costCurrency,
      purchasedAt: requiredText(formData, "purchasedAt"),
    },
  });
}

export async function addManualHolding(formData: FormData): Promise<void> {
  await createHolding({
    type: "manual",
    name: requiredText(formData, "name"),
    quoteCurrency: normalizeCurrencyCode(requiredText(formData, "currency")),
    manualValue: positiveNumber(formData, "manualValue"),
  });
}
