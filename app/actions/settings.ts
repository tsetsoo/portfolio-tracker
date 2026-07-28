"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/lib/db/client";
import { resetPortfolioData } from "@/lib/portfolio/reset";
import { setBaseCurrency } from "@/lib/settings";

export async function saveBaseCurrency(formData: FormData): Promise<void> {
  const value = formData.get("baseCurrency");
  if (typeof value !== "string") {
    throw new Error("Currency code is required");
  }

  setBaseCurrency(getDb(), value);
  revalidatePath("/");
  revalidatePath("/holdings");
  revalidatePath("/settings");
}

export async function resetPortfolioAction(
  formData: FormData,
): Promise<void> {
  const confirmation = formData.get("confirmation");
  if (typeof confirmation !== "string" || confirmation.trim() !== "RESET") {
    throw new Error('Type RESET to confirm wiping portfolio data');
  }

  resetPortfolioData(getDb());
  revalidatePath("/");
  revalidatePath("/holdings");
  revalidatePath("/import");
  revalidatePath("/settings");
}
