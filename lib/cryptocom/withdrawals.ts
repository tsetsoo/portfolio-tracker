import Papa from "papaparse";

import type { CryptoComWithdrawalRow } from "@/lib/wallets/types";

const FIAT = new Set([
  "EUR",
  "USD",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "SGD",
  "JPY",
  "TRY",
  "BRL",
  "BGN",
]);

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function findColumn(headers: string[], aliases: string[]): string | undefined {
  for (const header of headers) {
    if (aliases.includes(normalizeHeader(header))) return header;
  }
  return undefined;
}

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const num = Number(String(value).trim().replace(/,/g, ""));
  return Number.isFinite(num) ? Math.abs(num) : null;
}

function parseDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function inferChain(
  asset: string,
  description: string,
): CryptoComWithdrawalRow["chain"] | null {
  if (asset === "BTC" || description.includes("(BTC)")) return "btc";
  if (
    asset === "ETH" ||
    asset === "LINK" ||
    description.includes("ERC20") ||
    description.includes("(ETH)")
  ) {
    return "eth";
  }
  return null;
}

/**
 * Extract Crypto.com App `crypto_withdrawal` rows that can be tracked on
 * Ethereum or Bitcoin via a transaction hash.
 */
export function extractCryptoComWithdrawals(
  csvText: string,
): CryptoComWithdrawalRow[] {
  const trimmed = csvText.trim();
  if (!trimmed) return [];

  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  const fields = parsed.meta.fields ?? [];
  const isApp = fields.some((h) =>
    ["transaction kind", "transaction description"].includes(
      normalizeHeader(h),
    ),
  );
  if (!isApp) return [];

  const dateCol = findColumn(fields, ["timestamp (utc)", "timestamp", "date"]);
  const currencyCol = findColumn(fields, ["currency"]);
  const amountCol = findColumn(fields, ["amount"]);
  const kindCol = findColumn(fields, ["transaction kind", "kind"]);
  const hashCol = findColumn(fields, ["transaction hash", "txid", "hash"]);
  const descCol = findColumn(fields, [
    "transaction description",
    "description",
  ]);
  if (!dateCol || !currencyCol || !amountCol || !kindCol || !hashCol) {
    return [];
  }

  const out: CryptoComWithdrawalRow[] = [];
  const seen = new Set<string>();

  for (const record of parsed.data) {
    const kind = String(record[kindCol] ?? "")
      .trim()
      .toLowerCase();
    if (kind !== "crypto_withdrawal" && !kind.includes("withdraw")) continue;

    const asset = String(record[currencyCol] ?? "")
      .trim()
      .toUpperCase();
    if (!asset || FIAT.has(asset)) continue;

    const amount = parseAmount(record[amountCol]);
    const transferredAt = parseDate(record[dateCol]);
    const txHash = String(record[hashCol] ?? "").trim();
    const description = descCol
      ? String(record[descCol] ?? "").trim()
      : "";
    if (!amount || amount <= 0 || !transferredAt || !txHash) continue;

    const chain = inferChain(asset, description);
    if (!chain) continue;

    const key = `${chain}:${txHash.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      chain,
      asset,
      amount,
      txHash,
      transferredAt,
    });
  }

  return out;
}
