import { createHash } from "node:crypto";

import Papa from "papaparse";

export type CryptoComTradeRow = {
  symbol: string;
  quantity: number;
  costPerUnit: number;
  costCurrency: string;
  purchasedAt: string;
  fees: number;
  externalTradeId: string | null;
};

export type ParseResult = {
  rows: CryptoComTradeRow[];
  errors: Array<{ line: number; message: string }>;
};

const QUOTE_ASSETS = [
  "USDT",
  "USDC",
  "USD",
  "EUR",
  "GBP",
  "BTC",
  "ETH",
  "CRO",
].sort((a, b) => b.length - a.length);

const FIAT = new Set(["EUR", "USD", "GBP", "AUD", "CAD", "CHF", "SGD", "JPY"]);

const APP_BUY_KINDS = new Set([
  "crypto_purchase",
  "viban_purchase",
  "recurring_buy_order",
]);

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function findColumn(headers: string[], aliases: string[]): string | undefined {
  for (const header of headers) {
    if (aliases.includes(normalizeHeader(header))) {
      return header;
    }
  }
  return undefined;
}

function parseNumber(value: unknown, field: string): number {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new Error(`Missing ${field}`);
  }
  const num = Number(String(value).trim().replace(/,/g, ""));
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${field}`);
  }
  return num;
}

function parsePurchasedAt(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new Error("Missing date");
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  throw new Error("Invalid date");
}

function splitPair(pair: string): { base: string; quote: string } {
  const cleaned = pair.trim().toUpperCase().replace(/[/\-]/g, "_");
  if (cleaned.includes("_")) {
    const [base, quote] = cleaned.split("_");
    if (base && quote) return { base, quote };
  }
  const compact = cleaned.replace(/_/g, "");
  for (const quote of QUOTE_ASSETS) {
    if (compact.endsWith(quote) && compact.length > quote.length) {
      return { base: compact.slice(0, -quote.length), quote };
    }
  }
  throw new Error(`Unrecognized pair: ${pair}`);
}

function tradeId(prefix: string, explicit: string | null, material: string): string {
  if (explicit) {
    return explicit.startsWith("cryptocom:")
      ? explicit
      : `cryptocom:${explicit}`;
  }
  const hash = createHash("sha1").update(material).digest("hex").slice(0, 16);
  return `cryptocom:${prefix}:${hash}`;
}

function isAppExport(headers: string[]): boolean {
  return headers.some((h) =>
    ["transaction kind", "transactiondescription", "transaction description"].includes(
      normalizeHeader(h),
    ),
  );
}

function isExchangeExport(headers: string[]): boolean {
  const normalized = headers.map(normalizeHeader);
  return (
    normalized.some((h) => h === "trade price" || h === "tradeprice") &&
    normalized.some((h) => h === "trade amount" || h === "tradeamount" || h === "side")
  );
}

function parseAppExport(
  records: Record<string, string>[],
  fields: string[],
): ParseResult {
  const rows: CryptoComTradeRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  const dateCol = findColumn(fields, ["timestamp (utc)", "timestamp", "date"]);
  const currencyCol = findColumn(fields, ["currency"]);
  const amountCol = findColumn(fields, ["amount"]);
  const toCurrencyCol = findColumn(fields, ["to currency"]);
  const toAmountCol = findColumn(fields, ["to amount"]);
  const nativeCurrencyCol = findColumn(fields, ["native currency"]);
  const nativeAmountCol = findColumn(fields, ["native amount"]);
  const kindCol = findColumn(fields, ["transaction kind", "kind"]);
  const hashCol = findColumn(fields, ["transaction hash", "txid", "hash"]);

  if (!dateCol || !currencyCol || !amountCol || !kindCol) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message:
            "Missing required Crypto.com App headers (Timestamp, Currency, Amount, Transaction Kind)",
        },
      ],
    };
  }

  records.forEach((record, index) => {
    const line = index + 2;
    const kind = String(record[kindCol] ?? "")
      .trim()
      .toLowerCase();

    try {
      const purchasedAt = parsePurchasedAt(record[dateCol]);
      const hashRaw = hashCol ? String(record[hashCol] ?? "").trim() : "";
      const explicitId = hashRaw !== "" ? hashRaw : null;

      if (APP_BUY_KINDS.has(kind)) {
        const symbol = String(record[currencyCol] ?? "")
          .trim()
          .toUpperCase();
        const quantity = parseNumber(record[amountCol], "quantity");
        if (quantity <= 0) {
          errors.push({ line, message: "Skipped sell (non-positive quantity)" });
          return;
        }
        if (!nativeCurrencyCol || !nativeAmountCol) {
          throw new Error("Missing native currency/amount for purchase");
        }
        const costCurrency = String(record[nativeCurrencyCol] ?? "")
          .trim()
          .toUpperCase();
        const nativeAmount = Math.abs(
          parseNumber(record[nativeAmountCol], "native amount"),
        );
        if (!costCurrency || nativeAmount <= 0) {
          throw new Error("Invalid native cost for purchase");
        }
        const costPerUnit = nativeAmount / quantity;
        rows.push({
          symbol,
          quantity,
          costPerUnit,
          costCurrency,
          purchasedAt,
          fees: 0,
          externalTradeId: tradeId("app", explicitId, `${purchasedAt}|${kind}|${symbol}|${quantity}|${nativeAmount}`),
        });
        return;
      }

      if (kind === "crypto_exchange") {
        if (!toCurrencyCol || !toAmountCol) {
          errors.push({ line, message: "Skipped crypto_exchange without To Amount" });
          return;
        }
        const fromCurrency = String(record[currencyCol] ?? "")
          .trim()
          .toUpperCase();
        const fromAmount = parseNumber(record[amountCol], "amount");
        const toCurrency = String(record[toCurrencyCol] ?? "")
          .trim()
          .toUpperCase();
        const toAmount = parseNumber(record[toAmountCol], "to amount");

        // Receiving crypto (toAmount > 0) paid with fromCurrency
        if (toAmount > 0 && toCurrency && !FIAT.has(toCurrency)) {
          const cost = Math.abs(fromAmount);
          if (cost <= 0) {
            throw new Error("Invalid exchange cost");
          }
          rows.push({
            symbol: toCurrency,
            quantity: toAmount,
            costPerUnit: cost / toAmount,
            costCurrency: fromCurrency || "USD",
            purchasedAt,
            fees: 0,
            externalTradeId: tradeId(
              "app",
              explicitId,
              `${purchasedAt}|${kind}|${fromCurrency}|${fromAmount}|${toCurrency}|${toAmount}`,
            ),
          });
          return;
        }

        errors.push({ line, message: "Skipped sell / non-buy crypto_exchange" });
        return;
      }

      if (
        kind === "crypto_viban_exchange" ||
        kind.includes("sell") ||
        kind.includes("withdraw")
      ) {
        errors.push({ line, message: "Skipped sell" });
        return;
      }

      errors.push({ line, message: `Skipped ${kind || "unknown kind"}` });
    } catch (e) {
      errors.push({
        line,
        message: e instanceof Error ? e.message : "Invalid row",
      });
    }
  });

  return { rows, errors };
}

function parseExchangeExport(
  records: Record<string, string>[],
  fields: string[],
): ParseResult {
  const rows: CryptoComTradeRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  const dateCol = findColumn(fields, ["time (utc)", "time", "timestamp", "date"]);
  const symbolCol = findColumn(fields, ["symbol", "pair", "instrument"]);
  const sideCol = findColumn(fields, ["side"]);
  const priceCol = findColumn(fields, ["trade price", "price"]);
  const amountCol = findColumn(fields, ["trade amount", "amount", "quantity"]);
  const feeCol = findColumn(fields, ["fee"]);
  const feeCurrencyCol = findColumn(fields, ["fee currency", "fee coin"]);
  const tradeIdCol = findColumn(fields, ["trade id", "tradeid", "id"]);

  if (!dateCol || !symbolCol || !sideCol || !priceCol || !amountCol) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message:
            "Missing required Crypto.com Exchange headers (Time, Symbol, Side, Trade Price, Trade Amount)",
        },
      ],
    };
  }

  records.forEach((record, index) => {
    const line = index + 2;
    const side = String(record[sideCol] ?? "")
      .trim()
      .toUpperCase();

    if (side !== "BUY") {
      errors.push({
        line,
        message: side === "SELL" ? "Skipped sell" : `Skipped non-buy side: ${side}`,
      });
      return;
    }

    try {
      const { base, quote } = splitPair(String(record[symbolCol] ?? ""));
      const quantity = parseNumber(record[amountCol], "trade amount");
      if (quantity <= 0) {
        errors.push({ line, message: "Skipped sell (non-positive quantity)" });
        return;
      }
      const price = parseNumber(record[priceCol], "trade price");
      let fees = 0;
      if (feeCol && String(record[feeCol] ?? "").trim() !== "") {
        const feeAmount = Math.abs(parseNumber(record[feeCol], "fee"));
        const feeCurrency = feeCurrencyCol
          ? String(record[feeCurrencyCol] ?? "")
              .trim()
              .toUpperCase()
          : quote;
        if (feeCurrency === quote || feeCurrency === "") {
          fees = feeAmount;
        } else if (feeCurrency === base) {
          fees = feeAmount * price;
        }
      }

      const purchasedAt = parsePurchasedAt(record[dateCol]);
      const tradeIdRaw = tradeIdCol
        ? String(record[tradeIdCol] ?? "").trim()
        : "";
      rows.push({
        symbol: base,
        quantity,
        costPerUnit: price,
        costCurrency: quote,
        purchasedAt,
        fees,
        externalTradeId: tradeId(
          "ex",
          tradeIdRaw || null,
          `${purchasedAt}|${base}|${quote}|${quantity}|${price}|${fees}`,
        ),
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

export function parseCryptoComTradesCsv(csvText: string): ParseResult {
  const trimmed = csvText.trim();
  if (trimmed === "") {
    return { rows: [], errors: [{ line: 1, message: "Empty CSV" }] };
  }

  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  const fields = parsed.meta.fields ?? [];
  const parseErrors = parsed.errors.map((err) => ({
    line: (err.row ?? 0) + 1,
    message: err.message,
  }));

  if (isAppExport(fields)) {
    const result = parseAppExport(parsed.data, fields);
    return { rows: result.rows, errors: [...parseErrors, ...result.errors] };
  }

  if (isExchangeExport(fields)) {
    const result = parseExchangeExport(parsed.data, fields);
    return { rows: result.rows, errors: [...parseErrors, ...result.errors] };
  }

  return {
    rows: [],
    errors: [
      ...parseErrors,
      {
        line: 1,
        message:
          "Unrecognized Crypto.com CSV (expected App transaction history or Exchange trade history headers)",
      },
    ],
  };
}
