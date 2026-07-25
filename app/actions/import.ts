"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/lib/db/client";
import {
  commitIbkrImport,
  previewIbkrImport,
} from "@/lib/ibkr/commit";
import type { IbkrTradeRow } from "@/lib/ibkr/parse";

export async function previewIbkrCsv(csvText: string) {
  return previewIbkrImport(getDb(), csvText);
}

export async function commitIbkrRows(rows: IbkrTradeRow[]) {
  const result = commitIbkrImport(getDb(), rows);
  revalidatePath("/");
  revalidatePath("/holdings");
  revalidatePath("/import");
  return result;
}
