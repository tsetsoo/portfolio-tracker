import { createHash } from "node:crypto";

import Papa from "papaparse";

export type BinanceTradeRow = {
  symbol: string;
  quantity: number;
  costPerUnit: number;
  costCurrency: string;
  purchasedAt: string;
  fees: number;
  externalTradeId: string | null;
};

export type ParseResult = {
  rows: BinanceTradeRow[];
  errors: Array<{ line: number; message: string }>;
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
  ].join("|");
  const hash = createHash("sha1").update(material).digest("hex").slice(0, 16);
  return `binance:${hash}`;
}

export function parseBinanceTradesCsv(csvText: string): ParseResult {
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
  const dateCol = resolveColumn(fields, "date");
  const pairCol = resolveColumn(fields, "pair");
  const sideCol = resolveColumn(fields, "side");
  const priceCol = resolveColumn(fields, "price");
  const executedCol = resolveColumn(fields, "executed");
  const feeCol = resolveColumn(fields, "fee");
  const feeCoinCol = resolveColumn(fields, "feeCoin");
  const tradeIdCol = resolveColumn(fields, "tradeId");
  // Prefer dedicated executed qty; avoid using quote "Amount" as quantity
  const amountCol = resolveColumn(fields, "amount");
  const qtyCol =
    executedCol && normalizeHeader(executedCol) !== "amount"
      ? executedCol
      : executedCol ?? amountCol;

  if (!dateCol || !pairCol || !sideCol || !priceCol || !qtyCol) {
    return {
      rows: [],
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

  // If both Executed and Amount exist, always use Executed for quantity
  const quantityCol = executedCol ?? qtyCol;

  parsed.data.forEach((record, index) => {
    const line = index + 2;

    const side = String(record[sideCol] ?? "")
      .trim()
      .toUpperCase();
    if (side === "SELL") {
      errors.push({ line, message: "Skipped sell" });
      return;
    }
    if (side !== "BUY" && side !== "BUY_MARKET" && side !== "BUY_LIMIT") {
      // Some exports use Type for LIMIT/MARKET — Side should still be BUY/SELL
      if (side !== "" && !side.includes("BUY")) {
        errors.push({ line, message: `Skipped non-buy side: ${side}` });
        return;
      }
    }

    try {
      const pairRaw = String(record[pairCol] ?? "").trim();
      const { base, quote } = splitPair(pairRaw);
      const price = parseNumber(record[priceCol], "price");
      const executed = parseAmountWithAsset(record[quantityCol], "executed");
      if (executed.amount <= 0) {
        errors.push({ line, message: "Skipped sell (non-positive quantity)" });
        return;
      }
      if (executed.asset && executed.asset !== base) {
        throw new Error(
          `Executed asset ${executed.asset} does not match pair base ${base}`,
        );
      }

      const fees = feeCol
        ? resolveFees(record[feeCol], feeCoinCol ? record[feeCoinCol] : null, price, base, quote)
        : 0;

      const purchasedAt = parsePurchasedAt(record[dateCol]);
      const tradeIdRaw = tradeIdCol ? record[tradeIdCol] : undefined;
      const explicitId =
        tradeIdRaw !== undefined && String(tradeIdRaw).trim() !== ""
          ? String(tradeIdRaw).trim()
          : null;

      rows.push({
        symbol: base,
        quantity: executed.amount,
        costPerUnit: price,
        costCurrency: quote,
        purchasedAt,
        fees,
        externalTradeId: tradeIdFor(explicitId, {
          date: String(record[dateCol] ?? "").trim(),
          pair: pairRaw.toUpperCase(),
          side: side || "BUY",
          price,
          quantity: executed.amount,
          fee: fees,
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
}): string {
  const material = [
    parts.date,
    parts.coin,
    parts.units,
    parts.amount,
    parts.quote,
    parts.fee,
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
