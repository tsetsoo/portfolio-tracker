const HASKOIN_BASE =
  "https://api.blockchain.info/haskoin-store/bch/address";

/** CashAddr (with or without prefix) or legacy Base58. */
export function normalizeBchAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("bitcoincash:")) return lower;
  if (/^[qp][a-z0-9]{40,120}$/.test(lower)) {
    return `bitcoincash:${lower}`;
  }
  return trimmed;
}

export function isValidBchAddress(address: string): boolean {
  const normalized = normalizeBchAddress(address);
  if (!normalized) return false;
  if (normalized.startsWith("bitcoincash:")) {
    const payload = normalized.slice("bitcoincash:".length);
    return /^[qp][a-z0-9]{40,120}$/.test(payload);
  }
  return /^[13][a-km-zA-HJ-NP-Z1-9]{24,34}$/.test(normalized);
}

type HaskoinBalanceResponse = {
  confirmed?: number;
  unconfirmed?: number;
};

export async function fetchBchBalance(
  address: string,
  options: { fetchImpl?: typeof fetch; baseUrl?: string } = {},
): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? HASKOIN_BASE;
  const normalized = normalizeBchAddress(address);
  const response = await fetchImpl(
    `${base}/${encodeURIComponent(normalized)}/balance`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error(`BCH balance HTTP ${response.status}`);
  }
  const body = (await response.json()) as HaskoinBalanceResponse;
  return (body.confirmed ?? 0) / 1e8;
}
