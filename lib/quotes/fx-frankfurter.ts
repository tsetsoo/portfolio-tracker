interface FrankfurterResponse {
  rates?: Record<string, number>;
}

export async function fetchFrankfurterRate(
  from: string,
  to: string,
  fetchImpl: typeof fetch,
): Promise<number> {
  const url =
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}` +
    `&to=${encodeURIComponent(to)}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Frankfurter request failed (${response.status})`);
  }

  const payload = (await response.json()) as FrankfurterResponse;
  const rate = payload.rates?.[to];
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    throw new Error("Frankfurter returned an invalid rate");
  }
  return rate;
}

export async function fetchFrankfurterRateOnDate(
  from: string,
  to: string,
  date: string,
  fetchImpl: typeof fetch,
): Promise<number> {
  const day = date.slice(0, 10);
  const url =
    `https://api.frankfurter.app/${encodeURIComponent(day)}` +
    `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Frankfurter request failed (${response.status})`);
  }
  const payload = (await response.json()) as FrankfurterResponse;
  const rate = payload.rates?.[to];
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    throw new Error("Frankfurter returned an invalid rate");
  }
  return rate;
}
