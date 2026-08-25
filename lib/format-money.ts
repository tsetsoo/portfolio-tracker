const isoCurrencyCache = new Map<string, boolean>();

/**
 * Whether Intl will format `code` as a currency — which is NOT the same as
 * `code` being a real ISO-4217 currency. Intl accepts any well-formed
 * three-letter code, so CRO and BNB both pass here; USDT fails only because
 * it has four letters. A caller that needs genuine ISO-4217 membership
 * (e.g. deciding what may be sent to CoinGecko as a vs_currency, or what a
 * crypto alert may be denominated in) must use `isRealFiatCurrency` below
 * instead.
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

const ISO_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

/**
 * Whether `code` is a real ISO-4217 currency — stricter than
 * `isFiatCurrency`, which only checks that a code is well-formed enough for
 * Intl to accept it and therefore lets three-letter crypto tickers such as
 * CRO and BNB through. Intersecting with `Intl.supportedValuesOf("currency")`
 * closes that gap without touching `isFiatCurrency` itself, so
 * `formatMoney`'s rendering (which relies on the looser check to decide
 * Intl-currency-style vs. the crypto fallback) is unaffected.
 *
 * Use this wherever a crypto ticker must not be mistaken for a fiat
 * currency: gating a CoinGecko vs_currency, or a crypto alert's allowed
 * currency list.
 */
export function isRealFiatCurrency(code: string): boolean {
  return isFiatCurrency(code) && ISO_CURRENCIES.has(code.trim().toUpperCase());
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
