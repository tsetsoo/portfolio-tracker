import { createHash } from "node:crypto";

import Papa from "papaparse";

import {
  createFifoFxLookup,
  netFillsFifo,
  sortKeyFromDate,
  type FifoFxLookup,
  type LotFill,
  type LotRow,
} from "@/lib/import/fifo-net";
import type { WithdrawalCost } from "@/lib/cryptocom/parse";
import { attachWithdrawalCosts } from "@/lib/cryptocom/parse";
import { extractBinanceWithdrawals } from "@/lib/binance/withdrawals";
import type { ExchangeWithdrawalRow } from "@/lib/wallets/types";

export type BinanceTradeRow = LotRow;

export type ParseResult = {
  rows: BinanceTradeRow[];
  errors: Array<{ line: number; message: string }>;
  withdrawalCosts?: WithdrawalCost[];
  withdrawals?: ExchangeWithdrawalRow[];
};

/** Longest-first so USDT wins over USD, etc. */
const QUOTE_ASSETS = [
  "USDT",
  "USDC",
  "BUSD",
  "TUSD",
  "FDUSD",
  "EUR",
  "USD",
  "GBP",
  "TRY",
  "BRL",
  "BTC",
  "ETH",
  "BNB",
].sort((a, b) => b.length - a.length);

const FIAT_BASES = new Set([
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
]);

/** Stables bought via Convert are usually spent as quote — skip as holdings. */
const STABLE_BUY_SKIPS = new Set([
  "USDT",
  "USDC",
  "BUSD",
  "TUSD",
  "FDUSD",
  "DAI",
]);

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["date(utc)", "date", "utc_time", "time"],
  pair: ["pair", "symbol", "market"],
  side: ["side"],
  price: ["price", "average price", "avgprice"],
  executed: ["executed", "executed amount", "qty", "quantity", "amount"],
  amount: ["amount", "total", "trading total"],
  fee: ["fee", "commission", "fee amount"],
  feeCoin: ["fee coin", "feecoin", "fee asset", "commission asset"],
  tradeId: ["trade id", "tradeid", "id", "orderno", "order no", "orderid"],
};

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function resolveColumn(
  headers: string[],
  canonical: keyof typeof HEADER_ALIASES,
): string | undefined {
  const aliases = HEADER_ALIASES[canonical];
  for (const header of headers) {
    if (aliases.includes(normalizeHeader(header))) {
      return header;
    }
  }
  return undefined;
}

function parseNumber(value: unknown, field: string): number {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${field}`);
  }
  const text = String(value).trim();
  if (text === "") {
    throw new Error(`Missing ${field}`);
  }
  const num = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${field}`);
  }
  return num;
}

/** "0.02BTC", "0.02 BTC", or "0.02" → { amount, asset? } */
function parseAmountWithAsset(value: unknown, field: string): {
  amount: number;
  asset: string | null;
} {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${field}`);
  }
  const text = String(value).trim();
  if (text === "") {
    throw new Error(`Missing ${field}`);
  }

  const match = /^([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([A-Za-z]{2,10})?$/i.exec(
    text.replace(/,/g, ""),
  );
  if (!match) {
    throw new Error(`Invalid ${field}`);
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid ${field}`);
  }
  return {
    amount,
    asset: match[2] ? match[2].toUpperCase() : null,
  };
}

export function splitPair(pair: string): { base: string; quote: string } {
  const cleaned = pair.trim().toUpperCase().replace(/[/\-_]/g, "");
  if (cleaned === "") {
    throw new Error("Missing pair");
  }
  for (const quote of QUOTE_ASSETS) {
    if (cleaned.endsWith(quote) && cleaned.length > quote.length) {
      return { base: cleaned.slice(0, -quote.length), quote };
    }
  }
  throw new Error(`Unrecognized pair: ${pair}`);
}

function parsePurchasedAt(value: unknown): string {
  if (value === null || value === undefined) {
    throw new Error("Missing date");
  }
  const text = String(value).trim();
  if (text === "") {
    throw new Error("Missing date");
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    return text.slice(0, 10);
  }

  const withTime = /^(\d{4})-(\d{2})-(\d{2})[ T]/.exec(text);
  if (withTime) {
    return text.slice(0, 10);
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  throw new Error("Invalid date");
}

function resolveFees(
  feeRaw: unknown,
  feeCoinRaw: unknown,
  price: number,
  base: string,
  quote: string,
): number {
  if (feeRaw === null || feeRaw === undefined || String(feeRaw).trim() === "") {
    return 0;
  }

  const parsed = parseAmountWithAsset(feeRaw, "fee");
  const feeAsset =
    parsed.asset ??
    (feeCoinRaw !== null &&
    feeCoinRaw !== undefined &&
    String(feeCoinRaw).trim() !== ""
      ? String(feeCoinRaw).trim().toUpperCase()
      : quote);

  const abs = Math.abs(parsed.amount);
  if (feeAsset === quote) {
    return abs;
  }
  if (feeAsset === base) {
    return abs * price;
  }
  // Unknown fee asset (e.g. BNB) — omit from cost currency fees
  return 0;
}

function tradeIdFor(
  explicit: string | null,
  parts: {
    date: string;
    pair: string;
    side: string;
    price: number;
    quantity: number;
    fee: number;
    /** CSV line number — disambiguates identical fills at the same timestamp. */
    line: number;
  },
): string {
  if (explicit) {
    return explicit.startsWith("binance:") ? explicit : `binance:${explicit}`;
  }
  const material = [
    parts.date,
    parts.pair,
    parts.side,
    parts.price,
    parts.quantity,
    parts.fee,
    parts.line,
  ].join("|");
  const hash = createHash("sha1").update(material).digest("hex").slice(0, 16);
  return `binance:${hash}`;
}

function isBuySide(side: string): boolean {
  return (
    side === "BUY" ||
    side === "BUY_MARKET" ||
    side === "BUY_LIMIT" ||
    side.includes("BUY")
  );
}

function isSellSide(side: string): boolean {
  return (
    side === "SELL" ||
    side === "SELL_MARKET" ||
    side === "SELL_LIMIT" ||
    (side.includes("SELL") && !side.includes("BUY"))
  );
}

/** @deprecated Prefer netFillsFifo from @/lib/import/fifo-net */
export function netSpotFillsFifo(fills: LotFill[]): ParseResult {
  const netted = netFillsFifo(fills);
  return { rows: netted.rows, errors: netted.errors };
}

export function collectBinanceSpotFills(csvText: string): {
  fills: LotFill[];
  errors: Array<{ line: number; message: string }>;
} {
  const errors: Array<{ line: number; message: string }> = [];
  const fills: LotFill[] = [];

  const trimmed = csvText.trim();
  if (trimmed === "") {
    return {
      fills: [],
      errors: [{ line: 1, message: "Empty CSV" }],
    };
  }

  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  });

  for (const err of parsed.errors) {
    errors.push({
      line: (err.row ?? 0) + 1,
      message: err.message,
    });
  }

  const fields = parsed.meta.fields ?? [];
  const dateCol = resolveColumn(fields, "date");
  const pairCol = resolveColumn(fields, "pair");
  const sideCol = resolveColumn(fields, "side");
  const priceCol = resolveColumn(fields, "price");
  const executedCol = resolveColumn(fields, "executed");
  const feeCol = resolveColumn(fields, "fee");
  const feeCoinCol = resolveColumn(fields, "feeCoin");
  const tradeIdCol = resolveColumn(fields, "tradeId");
  const amountCol = resolveColumn(fields, "amount");
  const qtyCol =
    executedCol && normalizeHeader(executedCol) !== "amount"
      ? executedCol
      : executedCol ?? amountCol;

  if (!dateCol || !pairCol || !sideCol || !priceCol || !qtyCol) {
    return {
      fills: [],
      errors: [
        ...errors,
        {
          line: 1,
          message:
            "Missing required Binance trade headers (Date, Pair, Side, Price, Executed)",
        },
      ],
    };
  }

  const quantityCol = executedCol ?? qtyCol;

  parsed.data.forEach((record, index) => {
    const line = index + 2;

    const side = String(record[sideCol] ?? "")
      .trim()
      .toUpperCase();

    if (!isBuySide(side) && !isSellSide(side)) {
      if (side !== "") {
        errors.push({ line, message: `Skipped non-buy side: ${side}` });
      }
      return;
    }

    try {
      const pairRaw = String(record[pairCol] ?? "").trim();
      const { base, quote } = splitPair(pairRaw);
      if (FIAT_BASES.has(base)) {
        errors.push({
          line,
          message: `Skipped fiat pair base: ${base}`,
        });
        return;
      }
      const price = parseNumber(record[priceCol], "price");
      const executed = parseAmountWithAsset(record[quantityCol], "executed");
      if (executed.amount <= 0) {
        errors.push({ line, message: "Skipped non-positive quantity" });
        return;
      }
      if (executed.asset && executed.asset !== base) {
        throw new Error(
          `Executed asset ${executed.asset} does not match pair base ${base}`,
        );
      }

      const fees = feeCol
        ? resolveFees(
            record[feeCol],
            feeCoinCol ? record[feeCoinCol] : null,
            price,
            base,
            quote,
          )
        : 0;

      const dateRaw = String(record[dateCol] ?? "").trim();
      const purchasedAt = parsePurchasedAt(record[dateCol]);
      const tradeIdRaw = tradeIdCol ? record[tradeIdCol] : undefined;
      const explicitId =
        tradeIdRaw !== undefined && String(tradeIdRaw).trim() !== ""
          ? String(tradeIdRaw).trim()
          : null;

      const fillSide: "BUY" | "SELL" = isSellSide(side) ? "SELL" : "BUY";
      fills.push({
        line,
        order: index,
        sortKey: sortKeyFromDate(dateRaw),
        side: fillSide,
        row: {
          symbol: base,
          quantity: executed.amount,
          costPerUnit: price,
          costCurrency: quote,
          purchasedAt,
          fees,
          externalTradeId: tradeIdFor(explicitId, {
            date: dateRaw,
            pair: pairRaw.toUpperCase(),
            side: fillSide,
            price,
            quantity: executed.amount,
            fee: fees,
            line,
          }),
        },
      });
    } catch (e) {
      errors.push({
        line,
        message: e instanceof Error ? e.message : "Invalid row",
      });
    }
  });

  return { fills, errors };
}

export function parseBinanceTradesCsv(csvText: string): ParseResult {
  const { fills, errors } = collectBinanceSpotFills(csvText);
  if (fills.length === 0 && errors.length > 0) {
    return { rows: [], errors };
  }
  const netted = netFillsFifo(fills);
  return {
    rows: netted.rows,
    errors: [...errors, ...netted.errors],
  };
}

function rowsToBuyFills(
  rows: BinanceTradeRow[],
  orderOffset: number,
): LotFill[] {
  return rows.map((row, index) => ({
    line: orderOffset + index + 2,
    order: orderOffset + index,
    sortKey: sortKeyFromDate(`${row.purchasedAt}T12:00:00`),
    side: "BUY" as const,
    row,
  }));
}

/**
 * Spot + Convert + Auto-Invest buys/sells, then Withdraw History as
 * disposition=withdrawal fills. One FIFO → open lots + wallet transfer costs.
 */
export function parseBinanceUnifiedWithdraw(input: {
  withdrawCsv: string;
  spotCsv?: string;
  convertCsv?: string;
  autoInvestCsv?: string;
  fx?: FifoFxLookup | null;
}): ParseResult {
  const fx =
    input.fx ?? createFifoFxLookup({ baseCurrency: "EUR" });
  const fills: LotFill[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  let order = 0;

  if (input.spotCsv?.trim()) {
    const spot = collectBinanceSpotFills(input.spotCsv);
    errors.push(...spot.errors);
    for (const fill of spot.fills) {
      fills.push({ ...fill, order: order++ });
    }
  }

  if (input.convertCsv?.trim()) {
    const convert = parseBinanceConvertCsv(input.convertCsv);
    errors.push(...convert.errors);
    for (const fill of rowsToBuyFills(convert.rows, order)) {
      fills.push({ ...fill, order: order++ });
    }
  }

  if (input.autoInvestCsv?.trim()) {
    const auto = parseBinanceAutoInvestCsv(input.autoInvestCsv);
    errors.push(...auto.errors);
    for (const fill of rowsToBuyFills(auto.rows, order)) {
      fills.push({ ...fill, order: order++ });
    }
  }

  const extracted = extractBinanceWithdrawals(input.withdrawCsv);
  if (extracted.length === 0 && !input.withdrawCsv.trim()) {
    errors.push({ line: 1, message: "Empty withdraw CSV" });
  }

  for (const [index, wd] of extracted.entries()) {
    const tx = wd.txHash.startsWith("0x") || wd.chain === "eth"
      ? wd.txHash.toLowerCase()
      : wd.txHash;
    fills.push({
      line: 9000 + index,
      order: order++,
      sortKey: sortKeyFromDate(wd.transferredAt),
      side: "SELL",
      disposition: "withdrawal",
      row: {
        symbol: wd.asset,
        quantity: wd.fifoQuantity,
        costPerUnit: 0,
        costCurrency: "EUR",
        purchasedAt: wd.transferredAt.slice(0, 10),
        fees: 0,
        externalTradeId: `binance:${tx}`,
      },
    });
  }

  const netted = netFillsFifo(fills, fx);
  const withdrawalCosts: WithdrawalCost[] = netted.consumed
    .filter(
      (row) =>
        row.disposition === "withdrawal" &&
        row.externalTradeId != null &&
        row.externalTradeId !== "",
    )
    .map((row) => ({
      externalTradeId: row.externalTradeId!,
      asset: row.symbol,
      quantity: row.quantity,
      costBasis: row.costBasis,
      costCurrency: row.costCurrency,
      partial: row.partial,
    }));

  const transferRows = extracted.map((wd) => ({
    chain: wd.chain,
    asset: wd.asset,
    amount: wd.amount,
    txHash: wd.txHash,
    transferredAt: wd.transferredAt.slice(0, 10),
  }));

  return {
    rows: netted.rows,
    errors: [...errors, ...netted.errors],
    withdrawalCosts,
    withdrawals: attachWithdrawalCosts(transferRows, withdrawalCosts),
  };
}

const AUTO_INVEST_HEADERS: Record<string, string[]> = {
  date: ["time", "date", "date(utc)"],
  coin: ["holding coin", "coin", "crypto"],
  amount: ["amount per period", "amount", "investment amount"],
  units: ["units", "quantity", "executed"],
  fee: ["trading fee", "fee"],
  status: ["status"],
};

function resolveAutoInvestColumn(
  headers: string[],
  canonical: keyof typeof AUTO_INVEST_HEADERS,
): string | undefined {
  const aliases = AUTO_INVEST_HEADERS[canonical];
  for (const header of headers) {
    if (aliases.includes(normalizeHeader(header))) {
      return header;
    }
  }
  return undefined;
}

function isBlankFee(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return text === "" || text === "--" || text === "-";
}

function autoInvestTradeId(parts: {
  date: string;
  coin: string;
  units: number;
  amount: number;
  quote: string;
  fee: number;
  line: number;
}): string {
  const material = [
    parts.date,
    parts.coin,
    parts.units,
    parts.amount,
    parts.quote,
    parts.fee,
    parts.line,
  ].join("|");
  const hash = createHash("sha1").update(material).digest("hex").slice(0, 16);
  return `binance-auto:${hash}`;
}

/**
 * Binance Orders → Earn History → Auto-Invest export.
 * Success rows become crypto lots; cost/unit = Amount Per Period ÷ Units.
 */
export function parseBinanceAutoInvestCsv(csvText: string): ParseResult {
  const rows: BinanceTradeRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  const trimmed = csvText.trim();
  if (trimmed === "") {
    return {
      rows: [],
      errors: [{ line: 1, message: "Empty CSV" }],
    };
  }

  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  });

  for (const err of parsed.errors) {
    errors.push({
      line: (err.row ?? 0) + 1,
      message: err.message,
    });
  }

  const fields = parsed.meta.fields ?? [];
  const dateCol = resolveAutoInvestColumn(fields, "date");
  const coinCol = resolveAutoInvestColumn(fields, "coin");
  const amountCol = resolveAutoInvestColumn(fields, "amount");
  const unitsCol = resolveAutoInvestColumn(fields, "units");
  const feeCol = resolveAutoInvestColumn(fields, "fee");
  const statusCol = resolveAutoInvestColumn(fields, "status");

  // Require Auto-Invest-specific columns so Spot Trade History is rejected.
  const hasHoldingCoin = fields.some(
    (f) => normalizeHeader(f) === "holding coin",
  );
  const hasAmountPerPeriod = fields.some(
    (f) => normalizeHeader(f) === "amount per period",
  );

  if (
    !dateCol ||
    !coinCol ||
    !amountCol ||
    !unitsCol ||
    !hasHoldingCoin ||
    !hasAmountPerPeriod
  ) {
    return {
      rows: [],
      errors: [
        ...errors,
        {
          line: 1,
          message:
            "Missing required Binance Auto-Invest headers (Time, Holding Coin, Amount Per Period, Units)",
        },
      ],
    };
  }

  parsed.data.forEach((record, index) => {
    const line = index + 2;
    const status = statusCol
      ? String(record[statusCol] ?? "").trim().toLowerCase()
      : "success";

    if (status && status !== "success") {
      errors.push({
        line,
        message: `Skipped ${status || "non-success"} Auto-Invest row`,
      });
      return;
    }

    try {
      const coinRaw = String(record[coinCol] ?? "").trim().toUpperCase();
      if (coinRaw === "") {
        throw new Error("Missing holding coin");
      }

      const units = parseAmountWithAsset(record[unitsCol], "units");
      if (units.amount <= 0) {
        errors.push({ line, message: "Skipped zero-unit Auto-Invest row" });
        return;
      }
      if (units.asset && units.asset !== coinRaw) {
        throw new Error(
          `Units asset ${units.asset} does not match holding coin ${coinRaw}`,
        );
      }

      const spent = parseAmountWithAsset(record[amountCol], "amount");
      if (spent.amount <= 0) {
        throw new Error("Invalid amount per period");
      }
      const quote = spent.asset;
      if (!quote) {
        throw new Error("Missing quote currency on amount per period");
      }

      const costPerUnit = spent.amount / units.amount;
      let fees = 0;
      if (feeCol && !isBlankFee(record[feeCol])) {
        const feeParsed = parseAmountWithAsset(record[feeCol], "fee");
        const feeAsset = feeParsed.asset ?? quote;
        const abs = Math.abs(feeParsed.amount);
        if (feeAsset === quote) {
          fees = abs;
        } else if (feeAsset === coinRaw) {
          fees = abs * costPerUnit;
        }
      }

      const purchasedAt = parsePurchasedAt(record[dateCol]);
      const dateRaw = String(record[dateCol] ?? "").trim();

      rows.push({
        symbol: coinRaw,
        quantity: units.amount,
        costPerUnit,
        costCurrency: quote,
        purchasedAt,
        fees,
        externalTradeId: autoInvestTradeId({
          date: dateRaw,
          coin: coinRaw,
          units: units.amount,
          amount: spent.amount,
          quote,
          fee: fees,
          line,
        }),
      });
    } catch (e) {
      errors.push({
        line,
        message: e instanceof Error ? e.message : "Invalid row",
      });
    }
  });

  return { rows, errors };
}

const CONVERT_HEADERS: Record<string, string[]> = {
  date: ["time", "date", "date updated"],
  pair: ["pair"],
  sell: ["sell"],
  buy: ["buy"],
  status: ["status"],
};

function resolveConvertColumn(
  headers: string[],
  canonical: keyof typeof CONVERT_HEADERS,
): string | undefined {
  const aliases = CONVERT_HEADERS[canonical];
  for (const header of headers) {
    if (aliases.includes(normalizeHeader(header))) {
      return header;
    }
  }
  return undefined;
}

function convertTradeId(parts: {
  date: string;
  pair: string;
  sell: string;
  buy: string;
  line: number;
}): string {
  const material = [
    parts.date,
    parts.pair,
    parts.sell,
    parts.buy,
    parts.line,
  ].join("|");
  const hash = createHash("sha1").update(material).digest("hex").slice(0, 16);
  return `binance-convert:${hash}`;
}

/**
 * Binance Convert → Order History export.
 * Successful rows that buy a non-fiat asset become lots;
 * cost/unit = Sell amount ÷ Buy amount (fee baked into Convert price).
 */
export function parseBinanceConvertCsv(csvText: string): ParseResult {
  const rows: BinanceTradeRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  const trimmed = csvText.trim();
  if (trimmed === "") {
    return {
      rows: [],
      errors: [{ line: 1, message: "Empty CSV" }],
    };
  }

  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  });

  for (const err of parsed.errors) {
    errors.push({
      line: (err.row ?? 0) + 1,
      message: err.message,
    });
  }

  const fields = parsed.meta.fields ?? [];
  const dateCol = resolveConvertColumn(fields, "date");
  const pairCol = resolveConvertColumn(fields, "pair");
  const sellCol = resolveConvertColumn(fields, "sell");
  const buyCol = resolveConvertColumn(fields, "buy");
  const statusCol = resolveConvertColumn(fields, "status");

  const hasSell = fields.some((f) => normalizeHeader(f) === "sell");
  const hasBuy = fields.some((f) => normalizeHeader(f) === "buy");
  const hasInversePrice = fields.some(
    (f) => normalizeHeader(f) === "inverse price",
  );

  if (
    !dateCol ||
    !pairCol ||
    !sellCol ||
    !buyCol ||
    !hasSell ||
    !hasBuy ||
    !hasInversePrice
  ) {
    return {
      rows: [],
      errors: [
        ...errors,
        {
          line: 1,
          message:
            "Missing required Binance Convert headers (Time, Pair, Sell, Buy, Inverse Price)",
        },
      ],
    };
  }

  parsed.data.forEach((record, index) => {
    const line = index + 2;
    const status = statusCol
      ? String(record[statusCol] ?? "").trim().toLowerCase()
      : "successful";

    if (status && status !== "successful" && status !== "success") {
      errors.push({
        line,
        message: `Skipped ${status || "non-success"} Convert row`,
      });
      return;
    }

    try {
      const sellRaw = String(record[sellCol] ?? "").trim();
      const buyRaw = String(record[buyCol] ?? "").trim();
      const sell = parseAmountWithAsset(sellRaw, "sell");
      const buy = parseAmountWithAsset(buyRaw, "buy");

      if (!sell.asset) {
        throw new Error("Missing sell asset");
      }
      if (!buy.asset) {
        throw new Error("Missing buy asset");
      }
      if (buy.amount <= 0) {
        errors.push({ line, message: "Skipped zero-buy Convert row" });
        return;
      }
      if (sell.amount <= 0) {
        throw new Error("Invalid sell amount");
      }
      if (FIAT_BASES.has(buy.asset)) {
        errors.push({
          line,
          message: `Skipped fiat buy Convert row: ${buy.asset}`,
        });
        return;
      }
      if (STABLE_BUY_SKIPS.has(buy.asset)) {
        errors.push({
          line,
          message: `Skipped stable buy Convert row: ${buy.asset}`,
        });
        return;
      }

      const pairRaw = String(record[pairCol] ?? "").trim();
      const dateRaw = String(record[dateCol] ?? "").trim();
      const purchasedAt = parsePurchasedAt(dateRaw);

      rows.push({
        symbol: buy.asset,
        quantity: buy.amount,
        costPerUnit: sell.amount / buy.amount,
        costCurrency: sell.asset,
        purchasedAt,
        fees: 0,
        externalTradeId: convertTradeId({
          date: dateRaw,
          pair: pairRaw,
          sell: sellRaw,
          buy: buyRaw,
          line,
        }),
      });
    } catch (e) {
      errors.push({
        line,
        message: e instanceof Error ? e.message : "Invalid row",
      });
    }
  });

  return { rows, errors };
}
