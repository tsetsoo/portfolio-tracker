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
import {
  deleteImportBatchRecord,
  listImportBatches,
  renameImportBatch,
  type ImportBatch,
} from "@/lib/import/batches";
import {
  commitImportWithBatch,
  type CommitImportMeta,
} from "@/lib/import/commit-with-batch";

function revalidateImportPaths() {
  revalidatePath("/");
  revalidatePath("/holdings");
  revalidatePath("/import");
}

export type ImportCommitMetaInput = Omit<CommitImportMeta, "broker">;

export async function previewIbkrCsv(csvText: string) {
  return previewIbkrImport(getDb(), csvText);
}

export async function commitIbkrRows(
  rows: IbkrTradeRow[],
  meta?: ImportCommitMetaInput,
) {
  if (meta) {
    const result = commitImportWithBatch(getDb(), rows, {
      ...meta,
      broker: "ibkr",
      sourceDetail: meta.sourceDetail ?? "trades",
    });
    revalidateImportPaths();
    return result;
  }
  const result = commitIbkrImport(getDb(), rows);
  revalidateImportPaths();
  return result;
}

export async function previewBinanceCsv(
  csvText: string,
  format: "spot" | "auto-invest" = "spot",
) {
  return previewBinanceImport(getDb(), csvText, format);
}

export async function commitBinanceRows(
  rows: BinanceTradeRow[],
  meta?: ImportCommitMetaInput & { sourceDetail?: "spot" | "auto-invest" },
) {
  if (meta) {
    const result = commitImportWithBatch(getDb(), rows, {
      ...meta,
      broker: "binance",
      sourceDetail: meta.sourceDetail ?? "spot",
    });
    revalidateImportPaths();
    return result;
  }
  const result = commitBinanceImport(getDb(), rows);
  revalidateImportPaths();
  return result;
}

export async function previewCryptoComCsv(csvText: string) {
  return previewCryptoComImport(getDb(), csvText);
}

export async function commitCryptoComRows(
  rows: CryptoComTradeRow[],
  meta?: ImportCommitMetaInput,
) {
  if (meta) {
    const result = commitImportWithBatch(getDb(), rows, {
      ...meta,
      broker: "cryptocom",
      sourceDetail: meta.sourceDetail ?? "app",
    });
    revalidateImportPaths();
    return result;
  }
  const result = commitCryptoComImport(getDb(), rows);
  revalidateImportPaths();
  return result;
}

export async function listPastImports(): Promise<ImportBatch[]> {
  return listImportBatches(getDb());
}

export async function renamePastImport(
  id: string,
  name: string,
): Promise<void> {
  renameImportBatch(getDb(), id, name);
  revalidatePath("/import");
}

export async function deletePastImport(id: string): Promise<void> {
  deleteImportBatchRecord(getDb(), id);
  revalidatePath("/import");
}
