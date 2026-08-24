const isoCurrencyCache = new Map<string, boolean>();

/**
 * Whether `code` is a real ISO-4217 fiat currency (as opposed to a crypto
 * ticker or stablecoin symbol like USDT/CRO/BNB). Probes Intl.NumberFormat
 * rather than maintaining our own currency list, and memoizes the result
 * since the probe allocates a formatter.
 */
export function isFiatCurrency(code: string): boolean {
  const normalized = code.trim().toUpperCase();
  if (normalized === "") return false;
  const cached = isoCurrencyCache.get(normalized);
  if (cached !== undefined) return cached;

  try {
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: normalized,
    }).format(0);
    isoCurrencyCache.set(normalized, true);
    return true;
  } catch {
    isoCurrencyCache.set(normalized, false);
    return false;
  }
}

/**
 * Format a money amount. ISO-4217 codes use Intl currency style;
 * crypto quotes (USDT, USDC, …) fall back to "1,234.56 CODE".
 */
export function formatMoney(value: number, currency: string): string {
  const code = currency.trim().toUpperCase() || "USD";

  if (isFiatCurrency(code)) {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  const amount = new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(value);
  return `${amount} ${code}`;
}

export function formatSignedMoney(value: number, currency: string): string {
  const amount = formatMoney(Math.abs(value), currency);
  if (value > 0) return `+${amount}`;
  if (value < 0) return `−${amount}`;
  return amount;
}
