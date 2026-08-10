import Papa from "papaparse";

import {
  collectBinanceSpotFills,
  parseBinanceAutoInvestCsv,
  parseBinanceConvertCsv,
} from "@/lib/binance/parse";

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

/**
 * Best-effort scan of every date-like value in a CSV, independent of any
 * FIFO netting. Used for CDC files where buy fills aren't exported raw —
 * over-collecting a few extra dates is harmless (just extra Frankfurter
 * lookups), while under-collecting would leave withdrawal costs partial.
 */
function scanAllDates(csvText: string, dateAliases: string[]): string[] {
  const trimmed = csvText.trim();
  if (!trimmed) return [];

  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  });
  const fields = parsed.meta.fields ?? [];
  const dateCol = fields.find((field) =>
    dateAliases.includes(normalizeHeader(field)),
  );
  if (!dateCol) return [];

  const dates: string[] = [];
  for (const record of parsed.data) {
    const raw = String(record[dateCol] ?? "").trim();
    if (!raw) continue;
    const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
    if (isoMatch) {
      dates.push(isoMatch[1]!);
      continue;
    }
    const parsedDate = new Date(raw);
    if (!Number.isNaN(parsedDate.getTime())) {
      dates.push(parsedDate.toISOString().slice(0, 10));
    }
  }
  return dates;
}

/**
 * Collect every buy `purchasedAt` date (YYYY-MM-DD) across Binance
 * spot/convert/auto-invest CSVs and Crypto.com CSVs, so daily USD/EUR FX
 * rates can be prefetched *before* running FIFO (Frankfurter needs network,
 * and FIFO's date-aware FX lookup is synchronous against the DB cache).
 */
export function collectPurchaseDates(input: {
  binanceSpotCsv?: string;
  binanceConvertCsv?: string;
  binanceAutoCsv?: string;
  cdcCsvs?: string[];
}): string[] {
  const dates = new Set<string>();

  if (input.binanceSpotCsv?.trim()) {
    for (const fill of collectBinanceSpotFills(input.binanceSpotCsv).fills) {
      if (fill.side === "BUY") dates.add(fill.row.purchasedAt.slice(0, 10));
    }
  }

  if (input.binanceConvertCsv?.trim()) {
    for (const row of parseBinanceConvertCsv(input.binanceConvertCsv).rows) {
      dates.add(row.purchasedAt.slice(0, 10));
    }
  }

  if (input.binanceAutoCsv?.trim()) {
    for (const row of parseBinanceAutoInvestCsv(input.binanceAutoCsv).rows) {
      dates.add(row.purchasedAt.slice(0, 10));
    }
  }

  for (const csv of input.cdcCsvs ?? []) {
    for (const date of scanAllDates(csv, [
      "timestamp (utc)",
      "timestamp",
      "date",
    ])) {
      dates.add(date);
    }
  }

  return [...dates].sort();
}
