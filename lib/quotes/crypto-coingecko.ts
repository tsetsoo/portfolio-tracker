const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  CRO: "crypto-com-chain",
  SOL: "solana",
  ADA: "cardano",
  XRP: "ripple",
  DOGE: "dogecoin",
  BNB: "binancecoin",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  MATIC: "matic-network",
  POL: "polygon-ecosystem-token",
  LINK: "chainlink",
  LTC: "litecoin",
  ATOM: "cosmos",
  NEAR: "near",
  UNI: "uniswap",
  AAVE: "aave",
  SUI: "sui",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  TON: "the-open-network",
  TRX: "tron",
  STX: "blockstack",
  INJ: "injective-protocol",
  ETHW: "ethereum-pow-iou",
  USDC: "usd-coin",
  FTM: "fantom",
  BCH: "bitcoin-cash",
};

type CoinGeckoResponse = Record<string, Record<string, number>>;

export function coingeckoIdForSymbol(symbol: string): string | null {
  return COINGECKO_IDS[symbol.trim().toUpperCase()] ?? null;
}

type MarketChartRangeResponse = {
  prices?: Array<[number, number]>;
};

/**
 * Historical EUR (or USD) prices for a crypto over [fromDate, toDate] (UTC days).
 * Uses /coins/{id}/market_chart/range — one call covers many purchase dates.
 */
export async function fetchCoinGeckoMarketChartRange(
  symbol: string,
  vsCurrency: string,
  fromDate: string,
  toDate: string,
  fetchImpl: typeof fetch,
): Promise<Array<{ date: string; price: number }>> {
  const id = coingeckoIdForSymbol(symbol);
  if (!id) {
    throw new Error(`Unsupported crypto symbol: ${symbol}`);
  }
  const vs = vsCurrency.trim().toLowerCase();
  const fromMs = Date.parse(`${fromDate.slice(0, 10)}T00:00:00.000Z`);
  const toMs = Date.parse(`${toDate.slice(0, 10)}T23:59:59.999Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    throw new Error(`Invalid date range ${fromDate}..${toDate}`);
  }
  // Pad one day each side so daily buckets near the edges are present.
  const fromSec = Math.floor(fromMs / 1000) - 86_400;
  const toSec = Math.ceil(toMs / 1000) + 86_400;
  const url =
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}` +
    `/market_chart/range?vs_currency=${encodeURIComponent(vs)}` +
    `&from=${fromSec}&to=${toSec}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`CoinGecko request failed (${response.status})`);
  }
  const payload = (await response.json()) as MarketChartRangeResponse;
  const prices = payload.prices;
  if (!Array.isArray(prices)) {
    throw new Error("CoinGecko returned invalid market_chart data");
  }

  /** Keep last price observed on each UTC calendar day. */
  const byDate = new Map<string, number>();
  for (const point of prices) {
    const ts = point?.[0];
    const price = point?.[1];
    if (typeof ts !== "number" || typeof price !== "number" || !(price > 0)) {
      continue;
    }
    const date = new Date(ts).toISOString().slice(0, 10);
    byDate.set(date, price);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({ date, price }));
}

/** Price on `asOfDate` (YYYY-MM-DD): exact day, else nearest prior day in series. */
export function pickPriceOnOrBefore(
  series: Array<{ date: string; price: number }>,
  asOfDate: string,
): number | null {
  const day = asOfDate.slice(0, 10);
  let best: number | null = null;
  for (const row of series) {
    if (row.date > day) break;
    best = row.price;
  }
  return best;
}

function pickVsPrice(
  prices: Record<string, number> | undefined,
  preferredCurrency: "eur" | "usd",
): { price: number; currency: string } {
  const currency =
    typeof prices?.[preferredCurrency] === "number"
      ? preferredCurrency
      : "usd";
  const price = prices?.[currency];
  if (typeof price !== "number" || !Number.isFinite(price)) {
    throw new Error("CoinGecko returned an invalid quote");
  }
  return { price, currency: currency.toUpperCase() };
}

/** Batch quote fetch — one HTTP call for many symbols. */
export async function fetchCoinGeckoQuotes(
  symbols: string[],
  baseCurrency: string,
  fetchImpl: typeof fetch,
): Promise<Map<string, { price: number; currency: string }>> {
  const preferredCurrency = baseCurrency.toUpperCase() === "EUR" ? "eur" : "usd";
  const idBySymbol = new Map<string, string>();
  const unsupported: string[] = [];
  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || idBySymbol.has(symbol)) continue;
    const id = coingeckoIdForSymbol(symbol);
    if (!id) {
      unsupported.push(symbol);
      continue;
    }
    idBySymbol.set(symbol, id);
  }
  if (idBySymbol.size === 0 && unsupported.length > 0) {
    throw new Error(`Unsupported crypto symbol: ${unsupported[0]}`);
  }

  const result = new Map<string, { price: number; currency: string }>();
  if (idBySymbol.size === 0) return result;

  const ids = [...new Set(idBySymbol.values())];
  const url =
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(","))}` +
    "&vs_currencies=eur,usd";
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`CoinGecko request failed (${response.status})`);
  }

  const payload = (await response.json()) as CoinGeckoResponse;
  for (const [symbol, id] of idBySymbol) {
    result.set(symbol, pickVsPrice(payload[id], preferredCurrency));
  }
  return result;
}

export async function fetchCoinGeckoQuote(
  symbol: string,
  baseCurrency: string,
  fetchImpl: typeof fetch,
): Promise<{ price: number; currency: string }> {
  const quotes = await fetchCoinGeckoQuotes([symbol], baseCurrency, fetchImpl);
  const quote = quotes.get(symbol.trim().toUpperCase());
  if (!quote) {
    throw new Error(`Unsupported crypto symbol: ${symbol}`);
  }
  return quote;
}
