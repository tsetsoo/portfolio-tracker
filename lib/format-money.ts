const isoCurrencyCache = new Map<string, boolean>();

/**
 * Whether Intl will format `code` as a currency — which is NOT the same as
 * `code` being a real ISO-4217 currency. Intl accepts any well-formed
 * three-letter code, so CRO and BNB both pass here; USDT fails only because
 * it has four letters. A caller that needs genuine ISO-4217 membership must
 * intersect with `Intl.supportedValuesOf("currency")` — see
 * `allowedAlertCurrencies` in lib/alerts/currencies.ts, which does exactly
 * that to keep crypto denominations out of the alert currency list.
 *
 * Memoized because the probe allocates a formatter.
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
