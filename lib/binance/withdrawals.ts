import Papa from "papaparse";

import type { ExchangeWithdrawalRow, WalletChain } from "@/lib/wallets/types";

const TRACKED = new Set(["BTC", "ETH", "LINK"]);

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
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

function chainFor(asset: string, network: string): WalletChain | null {
  const net = network.trim().toUpperCase();
  if (asset === "BTC" || net === "BTC" || net === "BITCOIN") return "btc";
  if (
    asset === "ETH" ||
    asset === "LINK" ||
    net === "ETH" ||
    net === "ERC20" ||
    net === "ETHEREUM"
  ) {
    return "eth";
  }
  return null;
}

export type BinanceWithdrawalFill = ExchangeWithdrawalRow & {
  /** Coins that left Binance (Amount + Fee) for FIFO consumption. */
  fifoQuantity: number;
  fee: number;
};

/**
 * Parse Binance Wallet → Withdraw History CSV (includes TxID).
 * Completed rows with a TxID for BTC/ETH/LINK become withdrawal rows.
 */
export function extractBinanceWithdrawals(
  csvText: string,
): BinanceWithdrawalFill[] {
  const trimmed = csvText.trim();
  if (!trimmed) return [];

  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  });
  const fields = parsed.meta.fields ?? [];
  const timeCol = findColumn(fields, ["time", "date"]);
  const coinCol = findColumn(fields, ["coin", "asset", "currency"]);
  const networkCol = findColumn(fields, ["network", "chain"]);
  const amountCol = findColumn(fields, ["amount"]);
  const feeCol = findColumn(fields, ["fee", "transaction fee"]);
  const txidCol = findColumn(fields, ["txid", "tx id", "transaction id", "hash"]);
  const statusCol = findColumn(fields, ["status"]);

  if (!timeCol || !coinCol || !amountCol || !txidCol) {
    return [];
  }

  const out: BinanceWithdrawalFill[] = [];
  for (const record of parsed.data) {
    const status = statusCol
      ? String(record[statusCol] ?? "").trim().toLowerCase()
      : "completed";
    if (status && status !== "completed" && status !== "success") continue;

    const asset = String(record[coinCol] ?? "")
      .trim()
      .toUpperCase();
    if (!TRACKED.has(asset)) continue;

    const network = networkCol ? String(record[networkCol] ?? "") : "";
    const chain = chainFor(asset, network);
    if (!chain) continue;

    const amount = parseAmount(record[amountCol]);
    if (amount == null || amount <= 0) continue;

    const fee = feeCol ? (parseAmount(record[feeCol]) ?? 0) : 0;
    const txHash = String(record[txidCol] ?? "").trim();
    if (!txHash) continue;

    const transferredAt = parseDate(record[timeCol]);
    if (!transferredAt) continue;

    const sortTime = String(record[timeCol] ?? "").trim();

    const fifoQuantity =
      Math.round((amount + fee) * 1e12) / 1e12;
    out.push({
      chain,
      asset,
      amount,
      txHash,
      transferredAt: sortTime || transferredAt,
      fifoQuantity,
      fee,
    });
  }
  return out;
}
