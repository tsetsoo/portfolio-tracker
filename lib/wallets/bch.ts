const BLOCKCHAIR_BASE =
  "https://api.blockchair.com/bitcoin-cash/dashboards/address";

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

type BlockchairAddressResponse = {
  data?: Record<
    string,
    {
      address?: { balance?: number };
    }
  >;
};

export async function fetchBchBalance(
  address: string,
  options: { fetchImpl?: typeof fetch; baseUrl?: string } = {},
): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? BLOCKCHAIR_BASE;
  const normalized = normalizeBchAddress(address);
  const response = await fetchImpl(
    `${base}/${encodeURIComponent(normalized)}`,
  );
  if (!response.ok) {
    throw new Error(`Blockchair BCH HTTP ${response.status}`);
  }
  const body = (await response.json()) as BlockchairAddressResponse;
  const entry =
    body.data?.[normalized] ??
    body.data?.[normalized.replace(/^bitcoincash:/, "")] ??
    Object.values(body.data ?? {})[0];
  const sats = entry?.address?.balance ?? 0;
  return sats / 1e8;
}
