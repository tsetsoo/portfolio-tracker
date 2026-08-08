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

export type CryptoComTradeRow = LotRow;

export type WithdrawalCost = {
  /** Raw or cryptocom:-prefixed tx hash from the CSV. */
  externalTradeId: string;
  asset: string;
  quantity: number;
  costBasis: number;
  costCurrency: string;
  partial?: boolean;
};

export type ParseCryptoComOptions = {
  fx?: FifoFxLookup | null;
};

export type ParseResult = {
  rows: CryptoComTradeRow[];
  errors: Array<{ line: number; message: string }>;
  withdrawalCosts: WithdrawalCost[];
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

function tradeId(
  prefix: string,
  explicit: string | null,
  material: string,
): string {
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
    [
      "transaction kind",
      "transactiondescription",
      "transaction description",
    ].includes(normalizeHeader(h)),
  );
}

function isExchangeExport(headers: string[]): boolean {
  const normalized = headers.map(normalizeHeader);
  return (
    normalized.some((h) => h === "trade price" || h === "tradeprice") &&
    normalized.some(
      (h) => h === "trade amount" || h === "tradeamount" || h === "side",
    )
  );
}

function pushBuy(
  fills: LotFill[],
  meta: { line: number; order: number; sortKey: string },
  row: CryptoComTradeRow,
): void {
  if (FIAT.has(row.symbol)) {
    return;
  }
  fills.push({ ...meta, side: "BUY", row });
}

function pushSell(
  fills: LotFill[],
  meta: { line: number; order: number; sortKey: string },
  symbol: string,
  quantity: number,
  purchasedAt: string,
  externalTradeId: string,
  disposition: "sell" | "withdrawal" = "sell",
): void {
  if (FIAT.has(symbol) || quantity <= 0) {
    return;
  }
  fills.push({
    ...meta,
    side: "SELL",
    disposition,
    row: {
      symbol,
      quantity,
      costPerUnit: 0,
      costCurrency: "USD",
      purchasedAt,
      fees: 0,
      externalTradeId,
    },
  });
}

function parseAppExport(
  records: Record<string, string>[],
  fields: string[],
  fx?: FifoFxLookup | null,
): ParseResult {
  const errors: Array<{ line: number; message: string }> = [];
  const fills: LotFill[] = [];

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
      withdrawalCosts: [],
    };
  }

  records.forEach((record, index) => {
    const line = index + 2;
    const kind = String(record[kindCol] ?? "")
      .trim()
      .toLowerCase();

    try {
      const dateRaw = String(record[dateCol] ?? "").trim();
      const purchasedAt = parsePurchasedAt(record[dateCol]);
      const hashRaw = hashCol ? String(record[hashCol] ?? "").trim() : "";
      const explicitId = hashRaw !== "" ? hashRaw : null;
      const meta = {
        line,
        order: index,
        sortKey: sortKeyFromDate(dateRaw),
      };

      if (APP_BUY_KINDS.has(kind)) {
        const currency = String(record[currencyCol] ?? "")
          .trim()
          .toUpperCase();
        const amount = parseNumber(record[amountCol], "amount");
        const toCurrency = toCurrencyCol
          ? String(record[toCurrencyCol] ?? "")
              .trim()
              .toUpperCase()
          : "";
        const toAmountRaw =
          toAmountCol && String(record[toAmountCol] ?? "").trim() !== ""
            ? parseNumber(record[toAmountCol], "to amount")
            : null;

        // Recurring / viban often: Currency=EUR, To Currency=BTC, To Amount=qty
        if (
          toCurrency &&
          toAmountRaw !== null &&
          toAmountRaw > 0 &&
          !FIAT.has(toCurrency)
        ) {
          const nativeAmount =
            nativeAmountCol &&
            String(record[nativeAmountCol] ?? "").trim() !== ""
              ? Math.abs(parseNumber(record[nativeAmountCol], "native amount"))
              : Math.abs(amount);
          const costCurrency =
            nativeCurrencyCol &&
            String(record[nativeCurrencyCol] ?? "").trim() !== ""
              ? String(record[nativeCurrencyCol] ?? "")
                  .trim()
                  .toUpperCase()
              : FIAT.has(currency)
                ? currency
                : "EUR";
          if (nativeAmount <= 0) {
            throw new Error("Invalid native cost for purchase");
          }
          pushBuy(fills, meta, {
            symbol: toCurrency,
            quantity: toAmountRaw,
            costPerUnit: nativeAmount / toAmountRaw,
            costCurrency,
            purchasedAt,
            fees: 0,
            externalTradeId: tradeId(
              "app",
              explicitId,
              `${purchasedAt}|${kind}|${currency}|${amount}|${toCurrency}|${toAmountRaw}`,
            ),
          });
          return;
        }

        // Direct purchase: Currency=BTC, Amount=qty, Native=cost
        if (amount > 0 && !FIAT.has(currency)) {
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
          pushBuy(fills, meta, {
            symbol: currency,
            quantity: amount,
            costPerUnit: nativeAmount / amount,
            costCurrency,
            purchasedAt,
            fees: 0,
            externalTradeId: tradeId(
              "app",
              explicitId,
              `${purchasedAt}|${kind}|${currency}|${amount}|${nativeAmount}`,
            ),
          });
          return;
        }

        if (FIAT.has(currency) && !(toCurrency && !FIAT.has(toCurrency))) {
          errors.push({
            line,
            message: `Skipped fiat purchase row (${currency})`,
          });
          return;
        }

        errors.push({
          line,
          message: "Skipped sell (non-positive quantity)",
        });
        return;
      }

      if (kind === "crypto_exchange") {
        if (!toCurrencyCol || !toAmountCol) {
          errors.push({
            line,
            message: "Skipped crypto_exchange without To Amount",
          });
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
        const id = tradeId(
          "app",
          explicitId,
          `${purchasedAt}|${kind}|${fromCurrency}|${fromAmount}|${toCurrency}|${toAmount}`,
        );

        // Spending crypto → reduce inventory
        if (!FIAT.has(fromCurrency) && fromAmount < 0) {
          pushSell(
            fills,
            meta,
            fromCurrency,
            Math.abs(fromAmount),
            purchasedAt,
            `${id}:sell`,
          );
        }

        // Receiving crypto → new lot
        if (toAmount > 0 && toCurrency && !FIAT.has(toCurrency)) {
          const cost = Math.abs(fromAmount);
          if (cost <= 0) {
            throw new Error("Invalid exchange cost");
          }
          pushBuy(fills, meta, {
            symbol: toCurrency,
            quantity: toAmount,
            costPerUnit: cost / toAmount,
            costCurrency: fromCurrency || "USD",
            purchasedAt,
            fees: 0,
            externalTradeId: id,
          });
          return;
        }

        if (FIAT.has(toCurrency) || toAmount <= 0) {
          // crypto → fiat already recorded as sell above
          return;
        }

        errors.push({
          line,
          message: "Skipped sell / non-buy crypto_exchange",
        });
        return;
      }

      if (kind === "crypto_viban_exchange") {
        const symbol = String(record[currencyCol] ?? "")
          .trim()
          .toUpperCase();
        const amount = parseNumber(record[amountCol], "amount");
        if (FIAT.has(symbol)) {
          errors.push({ line, message: "Skipped fiat viban exchange" });
          return;
        }
        pushSell(
          fills,
          meta,
          symbol,
          Math.abs(amount),
          purchasedAt,
          tradeId(
            "app",
            explicitId,
            `${purchasedAt}|${kind}|${symbol}|${amount}`,
          ),
        );
        return;
      }

      if (kind === "crypto_withdrawal" || kind.includes("withdraw")) {
        const symbol = String(record[currencyCol] ?? "")
          .trim()
          .toUpperCase();
        const amount = parseNumber(record[amountCol], "amount");
        if (FIAT.has(symbol)) {
          errors.push({ line, message: "Skipped fiat withdrawal" });
          return;
        }
        pushSell(
          fills,
          meta,
          symbol,
          Math.abs(amount),
          purchasedAt,
          tradeId(
            "app",
            explicitId,
            `${purchasedAt}|${kind}|${symbol}|${amount}`,
          ),
          "withdrawal",
        );
        return;
      }

      if (kind === "crypto_wallet_swap_debited") {
        const symbol = String(record[currencyCol] ?? "")
          .trim()
          .toUpperCase();
        const amount = parseNumber(record[amountCol], "amount");
        if (FIAT.has(symbol)) {
          errors.push({ line, message: "Skipped fiat wallet swap debit" });
          return;
        }
        pushSell(
          fills,
          meta,
          symbol,
          Math.abs(amount),
          purchasedAt,
          tradeId(
            "app",
            explicitId,
            `${purchasedAt}|${kind}|${symbol}|${amount}`,
          ),
          "withdrawal",
        );
        return;
      }

      if (
        kind === "crypto_wallet_swap_credited" ||
        kind === "admin_wallet_credited"
      ) {
        const symbol = String(record[currencyCol] ?? "")
          .trim()
          .toUpperCase();
        const amount = parseNumber(record[amountCol], "amount");
        if (FIAT.has(symbol) || amount <= 0) {
          errors.push({
            line,
            message: `Skipped ${kind}${FIAT.has(symbol) ? " fiat" : ""}`,
          });
          return;
        }
        if (!nativeCurrencyCol || !nativeAmountCol) {
          throw new Error("Missing native currency/amount for wallet credit");
        }
        const costCurrency = String(record[nativeCurrencyCol] ?? "")
          .trim()
          .toUpperCase();
        const nativeAmount = Math.abs(
          parseNumber(record[nativeAmountCol], "native amount"),
        );
        if (!costCurrency || nativeAmount <= 0) {
          throw new Error("Invalid native cost for wallet credit");
        }
        pushBuy(fills, meta, {
          symbol,
          quantity: amount,
          costPerUnit: nativeAmount / amount,
          costCurrency,
          purchasedAt,
          fees: 0,
          externalTradeId: tradeId(
            "app",
            explicitId,
            `${purchasedAt}|${kind}|${symbol}|${amount}|${nativeAmount}`,
          ),
        });
        return;
      }

      if (kind.includes("sell")) {
        const symbol = String(record[currencyCol] ?? "")
          .trim()
          .toUpperCase();
        const amount = parseNumber(record[amountCol], "amount");
        pushSell(
          fills,
          meta,
          symbol,
          Math.abs(amount),
          purchasedAt,
          tradeId(
            "app",
            explicitId,
            `${purchasedAt}|${kind}|${symbol}|${amount}`,
          ),
        );
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
  return {
    rows: netted.rows,
    errors: [...errors, ...netted.errors],
    withdrawalCosts,
  };
}

function parseExchangeExport(
  records: Record<string, string>[],
  fields: string[],
  fx?: FifoFxLookup | null,
): ParseResult {
  const errors: Array<{ line: number; message: string }> = [];
  const fills: LotFill[] = [];

  const dateCol = findColumn(fields, [
    "time (utc)",
    "time",
    "timestamp",
    "date",
  ]);
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
      withdrawalCosts: [],
    };
  }

  records.forEach((record, index) => {
    const line = index + 2;
    const side = String(record[sideCol] ?? "")
      .trim()
      .toUpperCase();

    const isBuy = side === "BUY" || side.includes("BUY");
    const isSell =
      side === "SELL" || (side.includes("SELL") && !side.includes("BUY"));

    if (!isBuy && !isSell) {
      errors.push({ line, message: `Skipped non-buy side: ${side}` });
      return;
    }

    try {
      const { base, quote } = splitPair(String(record[symbolCol] ?? ""));
      if (FIAT.has(base)) {
        errors.push({ line, message: `Skipped fiat pair base: ${base}` });
        return;
      }
      const quantity = parseNumber(record[amountCol], "trade amount");
      if (quantity <= 0) {
        errors.push({ line, message: "Skipped non-positive quantity" });
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

      const dateRaw = String(record[dateCol] ?? "").trim();
      const purchasedAt = parsePurchasedAt(record[dateCol]);
      const tradeIdRaw = tradeIdCol
        ? String(record[tradeIdCol] ?? "").trim()
        : "";
      const id = tradeId(
        "ex",
        tradeIdRaw || null,
        `${purchasedAt}|${base}|${quote}|${side}|${quantity}|${price}|${fees}`,
      );

      fills.push({
        line,
        order: index,
        sortKey: sortKeyFromDate(dateRaw),
        side: isSell ? "SELL" : "BUY",
        row: {
          symbol: base,
          quantity,
          costPerUnit: price,
          costCurrency: quote,
          purchasedAt,
          fees,
          externalTradeId: id,
        },
      });
    } catch (e) {
      errors.push({
        line,
        message: e instanceof Error ? e.message : "Invalid row",
      });
    }
  });

  const netted = netFillsFifo(fills, fx);
  return {
    rows: netted.rows,
    errors: [...errors, ...netted.errors],
    withdrawalCosts: [],
  };
}

export function parseCryptoComTradesCsv(
  csvText: string,
  options: ParseCryptoComOptions = {},
): ParseResult {
  const fx =
    options.fx ??
    createFifoFxLookup({ baseCurrency: "EUR" });
  const trimmed = csvText.trim();
  if (trimmed === "") {
    return {
      rows: [],
      errors: [{ line: 1, message: "Empty CSV" }],
      withdrawalCosts: [],
    };
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
    const result = parseAppExport(parsed.data, fields, fx);
    return {
      rows: result.rows,
      errors: [...parseErrors, ...result.errors],
      withdrawalCosts: result.withdrawalCosts,
    };
  }

  if (isExchangeExport(fields)) {
    const result = parseExchangeExport(parsed.data, fields, fx);
    return {
      rows: result.rows,
      errors: [...parseErrors, ...result.errors],
      withdrawalCosts: result.withdrawalCosts,
    };
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
    withdrawalCosts: [],
  };
}

/** Match FIFO withdrawal costs onto extracted on-chain withdrawal rows by tx hash. */
export function attachWithdrawalCosts(
  withdrawals: import("@/lib/wallets/types").ExchangeWithdrawalRow[],
  costs: WithdrawalCost[],
): import("@/lib/wallets/types").ExchangeWithdrawalRow[] {
  const byHash = new Map<string, WithdrawalCost>();
  for (const cost of costs) {
    const raw = cost.externalTradeId
      .replace(/^(cryptocom|binance):/i, "")
      .toLowerCase();
    byHash.set(raw, cost);
    byHash.set(cost.externalTradeId.toLowerCase(), cost);
  }
  return withdrawals.map((row) => {
    const cost =
      byHash.get(row.txHash.toLowerCase()) ??
      byHash.get(row.txHash.toLowerCase().replace(/^0x/, ""));
    if (!cost) return row;
    return {
      ...row,
      costBasis: cost.costBasis,
      costCurrency: cost.costCurrency,
      costStatus: cost.partial ? "partial" : "costed",
      costNotes: cost.partial
        ? "Mixed lot currencies; some FX rates missing"
        : row.costNotes,
    };
  });
}
