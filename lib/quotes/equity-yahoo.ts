interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        currency?: string;
      };
    }> | null;
  };
}

/** UCITS / European listings whose Yahoo ticker differs from the IBKR symbol. */
const YAHOO_CURRENCY_ALIASES: Record<string, Partial<Record<string, string>>> = {
  // VanEck Semiconductor UCITS ETF (EUR) — bare SMH is the US fund.
  SMH: { EUR: "VVSM.DE" },
};

const EUR_SUFFIXES = [".DE", ".PA", ".AS", ".MI"] as const;
const GBP_SUFFIXES = [".L"] as const;

export function yahooSymbolCandidates(
  symbol: string,
  preferredCurrency?: string,
): string[] {
  const base = symbol.trim().toUpperCase();
  if (base === "") {
    return [];
  }
  if (base.includes(".")) {
    return [base];
  }

  const preferred = preferredCurrency?.trim().toUpperCase();
  const alias = preferred
    ? YAHOO_CURRENCY_ALIASES[base]?.[preferred]
    : undefined;

  if (preferred === "EUR") {
    return [
      ...(alias ? [alias] : []),
      ...EUR_SUFFIXES.map((suffix) => `${base}${suffix}`),
      base,
    ];
  }

  if (preferred === "GBP") {
    return [
      ...(alias ? [alias] : []),
      ...GBP_SUFFIXES.map((suffix) => `${base}${suffix}`),
      base,
    ];
  }

  return [base];
}

function normalizeYahooCurrency(
  price: number,
  currency: string,
): { price: number; currency: string } {
  // LSE often quotes in pence (GBp / GBX).
  if (currency === "GBp" || currency.toUpperCase() === "GBX") {
    return { price: price / 100, currency: "GBP" };
  }
  return { price, currency: currency.toUpperCase() };
}

function currenciesMatch(actual: string, preferred: string): boolean {
  return actual.toUpperCase() === preferred.toUpperCase();
}

async function fetchYahooSymbol(
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<{ price: number; currency: string }> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    throw new Error(`Yahoo request failed (${response.status})`);
  }

  const payload = (await response.json()) as YahooChartResponse;
  const meta = payload.chart?.result?.[0]?.meta;
  if (
    typeof meta?.regularMarketPrice !== "number" ||
    !Number.isFinite(meta.regularMarketPrice) ||
    !meta.currency
  ) {
    throw new Error("Yahoo returned an invalid quote");
  }

  return normalizeYahooCurrency(meta.regularMarketPrice, meta.currency);
}

export async function fetchYahooQuote(
  symbol: string,
  fetchImpl: typeof fetch,
  opts?: { preferredCurrency?: string },
): Promise<{ price: number; currency: string }> {
  const preferred = opts?.preferredCurrency?.trim().toUpperCase() || undefined;
  const candidates = yahooSymbolCandidates(symbol, preferred);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const quote = await fetchYahooSymbol(candidate, fetchImpl);
      if (!preferred || currenciesMatch(quote.currency, preferred)) {
        return quote;
      }
      lastError = new Error(
        `Yahoo quote currency mismatch for ${candidate}: ${quote.currency} != ${preferred}`,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw (
    lastError ??
    new Error(
      preferred
        ? `No Yahoo quote in ${preferred} for ${symbol}`
        : `No Yahoo quote for ${symbol}`,
    )
  );
}
