"use server";

import { revalidatePath } from "next/cache";

import {
  commitBinanceImport,
  previewBinanceImport,
} from "@/lib/binance/commit";
import type { BinanceTradeRow } from "@/lib/binance/parse";
import {
  commitCryptoComImport,
  previewCryptoComImport,
} from "@/lib/cryptocom/commit";
import type { CryptoComTradeRow } from "@/lib/cryptocom/parse";
import { getDb } from "@/lib/db/client";
import {
  commitIbkrImport,
  previewIbkrImport,
} from "@/lib/ibkr/commit";
import type { IbkrTradeRow } from "@/lib/ibkr/parse";

function revalidateImportPaths() {
  revalidatePath("/");
  revalidatePath("/holdings");
  revalidatePath("/import");
}

export async function previewIbkrCsv(csvText: string) {
  return previewIbkrImport(getDb(), csvText);
}

export async function commitIbkrRows(rows: IbkrTradeRow[]) {
  const result = commitIbkrImport(getDb(), rows);
  revalidateImportPaths();
  return result;
}

export async function previewBinanceCsv(csvText: string) {
  return previewBinanceImport(getDb(), csvText);
}

export async function commitBinanceRows(rows: BinanceTradeRow[]) {
  const result = commitBinanceImport(getDb(), rows);
  revalidateImportPaths();
  return result;
}

export async function previewCryptoComCsv(csvText: string) {
  return previewCryptoComImport(getDb(), csvText);
}

export async function commitCryptoComRows(rows: CryptoComTradeRow[]) {
  const result = commitCryptoComImport(getDb(), rows);
  revalidateImportPaths();
  return result;
}
