"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/lib/db/client";
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
