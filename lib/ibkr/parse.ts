import Papa from "papaparse";

export type IbkrTradeRow = {
  symbol: string;
  quantity: number;
  costPerUnit: number;
  costCurrency: string;
  purchasedAt: string;
  fees: number;
  externalTradeId: string | null;
};

export type ParseResult = {
  rows: IbkrTradeRow[];
  errors: Array<{ line: number; message: string }>;
};

const HEADER_ALIASES: Record<string, string[]> = {
  symbol: ["symbol"],
  quantity: ["quantity"],
  tradePrice: ["tradeprice", "t. price", "t price", "price"],
  currency: ["currencyprimary", "currency"],
  dateTime: ["datetime", "tradedate", "date/time", "date"],
  commission: ["ibcommission", "comm/fee", "commission", "fees"],
  tradeId: ["tradeid", "transactionid", "execid"],
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

function parseFees(value: unknown): number {
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

function lineNumberFromParse(
  parseResult: Papa.ParseResult<Record<string, string>>,
  rowIndex: number,
): number {
  const meta = parseResult.meta;
  if (meta.fields && meta.cursor !== undefined) {
    return rowIndex + 2;
  }
  return rowIndex + 2;
}

export function parseIbkrTradesCsv(csvText: string): ParseResult {
  const rows: IbkrTradeRow[] = [];
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
    transformHeader: (header) => header.trim(),
  });

  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      errors.push({
        line: (err.row ?? 0) + 1,
        message: err.message,
      });
    }
  }

  const fields = parsed.meta.fields ?? [];
  const symbolCol = resolveColumn(fields, "symbol");
  const quantityCol = resolveColumn(fields, "quantity");
  const priceCol = resolveColumn(fields, "tradePrice");
  const currencyCol = resolveColumn(fields, "currency");
  const dateCol = resolveColumn(fields, "dateTime");
  const commissionCol = resolveColumn(fields, "commission");
  const tradeIdCol = resolveColumn(fields, "tradeId");

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
        ...errors,
        {
          line: 1,
          message:
            "Missing required IBKR trade headers (Symbol, Quantity, price, currency, date, commission)",
        },
      ],
    };
  }

  parsed.data.forEach((record, index) => {
    const line = lineNumberFromParse(parsed, index);

    let quantity: number;
    try {
      quantity = parseNumber(record[quantityCol], "quantity");
    } catch (e) {
      errors.push({
        line,
        message: e instanceof Error ? e.message : "Invalid quantity",
      });
      return;
    }

    if (quantity <= 0) {
      errors.push({ line, message: "Skipped sell (non-positive quantity)" });
      return;
    }

    try {
      const symbol = String(record[symbolCol] ?? "").trim();
      if (symbol === "") {
        throw new Error("Missing symbol");
      }

      const tradeIdRaw = tradeIdCol ? record[tradeIdCol] : undefined;
      const externalTradeId =
        tradeIdRaw !== undefined && String(tradeIdRaw).trim() !== ""
          ? String(tradeIdRaw).trim()
          : null;

      rows.push({
        symbol,
        quantity,
        costPerUnit: parseNumber(record[priceCol], "trade price"),
        costCurrency: String(record[currencyCol] ?? "").trim().toUpperCase(),
        purchasedAt: parsePurchasedAt(record[dateCol]),
        fees: parseFees(record[commissionCol]),
        externalTradeId,
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
