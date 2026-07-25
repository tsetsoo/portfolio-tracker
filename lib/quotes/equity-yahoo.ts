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

export async function fetchYahooQuote(
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<{ price: number; currency: string }> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const response = await fetchImpl(url);
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

  return {
    price: meta.regularMarketPrice,
    currency: meta.currency.toUpperCase(),
  };
}
