import Papa from "papaparse";

import {
  netFillsFifo,
  sortKeyFromDate,
  type LotFill,
  type LotRow,
} from "@/lib/import/fifo-net";

export type IbkrTradeRow = LotRow;

export type ParseResult = {
  rows: IbkrTradeRow[];
  errors: Array<{ line: number; message: string }>;
};

const HEADER_ALIASES: Record<string, string[]> = {
  symbol: ["symbol"],
  quantity: ["quantity"],
  tradePrice: ["tradeprice", "t. price", "t price", "price"],
  currency: ["currencyprimary", "currency", "price currency"],
  dateTime: ["datetime", "tradedate", "date/time", "date"],
  commission: ["ibcommission", "comm/fee", "commission", "fees"],
  tradeId: ["tradeid", "transactionid", "execid"],
  transactionType: ["transaction type", "transactiontype", "buy/sell", "buysell"],
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function resolveColumn(
  headers: string[],
  canonical: keyof typeof HEADER_ALIASES,
): string | undefined {
  const aliases = HEADER_ALIASES[canonical];
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (aliases.includes(normalized)) {
      return header;
    }
  }
  return undefined;
}

function isBlankCell(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  const text = String(value).trim();
  return text === "" || text === "-";
}

function parseNumber(value: unknown, field: string): number {
  if (isBlankCell(value)) {
    throw new Error(`Missing ${field}`);
  }
  const text = String(value).trim();
  const num = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${field}`);
  }
  return num;
}

function parseFees(value: unknown): number {
  if (isBlankCell(value)) {
    return 0;
  }
  const raw = parseNumber(value, "commission");
  return Math.abs(raw);
}

function parsePurchasedAt(value: unknown): string {
  if (value === null || value === undefined) {
    throw new Error("Missing date");
  }
  const text = String(value).trim();
  if (text === "") {
    throw new Error("Missing date");
  }

  const semicolonMatch = /^(\d{4})(\d{2})(\d{2});(\d{2})(\d{2})(\d{2})$/.exec(
    text,
  );
  if (semicolonMatch) {
    const [, y, m, d] = semicolonMatch;
    return `${y}-${m}-${d}`;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    return text.slice(0, 10);
  }

  const withTime = /^(\d{4})-(\d{2})-(\d{2})\s/.exec(text);
  if (withTime) {
    return text.slice(0, 10);
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  throw new Error("Invalid date");
}

type NormalizedTable = {
  fields: string[];
  records: Array<{ record: Record<string, string>; line: number }>;
};

/**
 * IBKR Client Portal "Transaction History" / Activity Statement CSVs are
 * sectioned: `Section,Type,col1,col2,...` rather than a single flat header.
 */
function extractTransactionHistoryTable(csvText: string): NormalizedTable | null {
  const parsed = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: true,
  });

  const headerRow = parsed.data.find(
    (raw) =>
      String(raw[0] ?? "").trim() === "Transaction History" &&
      String(raw[1] ?? "").trim().toLowerCase() === "header",
  );
  if (!headerRow) {
    return null;
  }

  const fields = headerRow.slice(2).map((h) => String(h ?? "").trim());
  if (fields.length === 0) {
    return null;
  }

  const records: NormalizedTable["records"] = [];
  parsed.data.forEach((raw, index) => {
    const line = index + 1;
    if (raw.length < 2) {
      return;
    }
    const section = String(raw[0] ?? "").trim();
    const rowType = String(raw[1] ?? "").trim().toLowerCase();
    if (section !== "Transaction History" || rowType !== "data") {
      return;
    }
    const values = raw.slice(2);
    const record: Record<string, string> = {};
    fields.forEach((header, i) => {
      record[header] = values[i] !== undefined ? String(values[i]) : "";
    });
    records.push({ record, line });
  });

  return { fields, records };
}

function extractFlatTable(csvText: string): NormalizedTable {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  const fields = (parsed.meta.fields ?? []).map((f) => f.trim());
  const records = parsed.data.map((record, index) => ({
    record,
    line: index + 2,
  }));

  // Surface Papa parse issues as empty fields path; callers add header errors.
  void parsed.errors;

  return { fields, records };
}

function looksLikeSectionedStatement(csvText: string): boolean {
  const head = csvText.slice(0, 2000);
  return (
    /Transaction History,\s*Header/i.test(head) ||
    /^Statement,\s*(Header|Data)/im.test(head)
  );
}

function isBuyType(rawType: string): boolean {
  return rawType === "buy" || rawType === "bot";
}

function isSellType(rawType: string): boolean {
  return rawType === "sell" || rawType === "sld";
}

function parseTradeRecords(
  table: NormalizedTable,
  options: { requireTransactionTypeFilter: boolean },
): ParseResult {
  const errors: Array<{ line: number; message: string }> = [];
  const fills: LotFill[] = [];

  const symbolCol = resolveColumn(table.fields, "symbol");
  const quantityCol = resolveColumn(table.fields, "quantity");
  const priceCol = resolveColumn(table.fields, "tradePrice");
  const currencyCol = resolveColumn(table.fields, "currency");
  const dateCol = resolveColumn(table.fields, "dateTime");
  const commissionCol = resolveColumn(table.fields, "commission");
  const tradeIdCol = resolveColumn(table.fields, "tradeId");
  const typeCol = resolveColumn(table.fields, "transactionType");

  if (
    !symbolCol ||
    !quantityCol ||
    !priceCol ||
    !currencyCol ||
    !dateCol ||
    !commissionCol
  ) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message:
            "Missing required IBKR trade headers (Symbol, Quantity, price, currency, date, commission)",
        },
      ],
    };
  }

  table.records.forEach(({ record, line }, order) => {
    const rawType = typeCol
      ? String(record[typeCol] ?? "").trim().toLowerCase()
      : "";

    if (options.requireTransactionTypeFilter || typeCol) {
      if (rawType !== "" && !isBuyType(rawType) && !isSellType(rawType)) {
        // Deposits, dividends, forex, adjustments, etc. — ignore quietly.
        return;
      }
    }

    if (isBlankCell(record[quantityCol]) || isBlankCell(record[symbolCol])) {
      return;
    }

    let signedQty: number;
    try {
      signedQty = parseNumber(record[quantityCol], "quantity");
    } catch (e) {
      errors.push({
        line,
        message: e instanceof Error ? e.message : "Invalid quantity",
      });
      return;
    }

    const sideFromType = isSellType(rawType)
      ? "SELL"
      : isBuyType(rawType)
        ? "BUY"
        : null;
    const side: "BUY" | "SELL" =
      sideFromType ?? (signedQty < 0 ? "SELL" : "BUY");
    const quantity = Math.abs(signedQty);

    if (quantity <= 0) {
      errors.push({ line, message: "Skipped non-positive quantity" });
      return;
    }

    try {
      const symbol = String(record[symbolCol] ?? "").trim();
      if (symbol === "" || symbol === "-") {
        throw new Error("Missing symbol");
      }

      const tradeIdRaw = tradeIdCol ? record[tradeIdCol] : undefined;
      const externalTradeId =
        tradeIdRaw !== undefined &&
        !isBlankCell(tradeIdRaw) &&
        String(tradeIdRaw).trim() !== ""
          ? String(tradeIdRaw).trim()
          : null;

      const dateRaw = String(record[dateCol] ?? "").trim();
      fills.push({
        line,
        order,
        sortKey: sortKeyFromDate(dateRaw),
        side,
        row: {
          symbol,
          quantity,
          costPerUnit: parseNumber(record[priceCol], "trade price"),
          costCurrency: String(record[currencyCol] ?? "").trim().toUpperCase(),
          purchasedAt: parsePurchasedAt(record[dateCol]),
          fees: parseFees(record[commissionCol]),
          externalTradeId,
        },
      });
    } catch (e) {
      errors.push({
        line,
        message: e instanceof Error ? e.message : "Invalid row",
      });
    }
  });

  const netted = netFillsFifo(fills);
  return { rows: netted.rows, errors: [...errors, ...netted.errors] };
}

export function parseIbkrTradesCsv(csvText: string): ParseResult {
  const trimmed = csvText.trim();
  if (trimmed === "") {
    return {
      rows: [],
      errors: [{ line: 1, message: "Empty CSV" }],
    };
  }

  if (looksLikeSectionedStatement(trimmed)) {
    const history = extractTransactionHistoryTable(trimmed);
    if (!history) {
      return {
        rows: [],
        errors: [
          {
            line: 1,
            message:
              "IBKR statement CSV found, but no Transaction History section with trade headers",
          },
        ],
      };
    }
    return parseTradeRecords(history, { requireTransactionTypeFilter: true });
  }

  return parseTradeRecords(extractFlatTable(trimmed), {
    requireTransactionTypeFilter: false,
  });
}
