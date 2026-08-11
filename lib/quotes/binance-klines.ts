/**
 * Historical crypto→fiat from Binance public klines (no API key; full history).
 * Prefer *EUR pairs when listed, else *USDT × USD→EUR from fx_rates_daily.
 */
export async function fetchBinanceDailyClose(
  symbol: string,
  quote: "EUR" | "USDT",
  fromDate: string,
  toDate: string,
  fetchImpl: typeof fetch,
): Promise<Array<{ date: string; price: number }>> {
  const pair = `${symbol.trim().toUpperCase()}${quote}`;
  const fromMs = Date.parse(`${fromDate.slice(0, 10)}T00:00:00.000Z`);
  const toMs = Date.parse(`${toDate.slice(0, 10)}T23:59:59.999Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    throw new Error(`Invalid date range ${fromDate}..${toDate}`);
  }

  const byDate = new Map<string, number>();
  let cursor = fromMs;
  // Binance klines max 1000 candles per request.
  while (cursor <= toMs) {
    const url =
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}` +
      `&interval=1d&startTime=${cursor}&endTime=${toMs}&limit=1000`;
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Binance klines failed (${response.status}) for ${pair}`);
    }
    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) break;

    let lastOpen = cursor;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const openTime = Number(row[0]);
      const close = Number(row[4]);
      if (!Number.isFinite(openTime) || !(close > 0)) continue;
      const date = new Date(openTime).toISOString().slice(0, 10);
      byDate.set(date, close);
      lastOpen = openTime;
    }
    const next = lastOpen + 86_400_000;
    if (next <= cursor) break;
    cursor = next;
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({ date, price }));
}

export async function binancePairExists(
  symbol: string,
  quote: "EUR" | "USDT",
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const pair = `${symbol.trim().toUpperCase()}${quote}`;
  const url = `https://api.binance.com/api/v3/exchangeInfo?symbol=${encodeURIComponent(pair)}`;
  const response = await fetchImpl(url);
  return response.ok;
}
