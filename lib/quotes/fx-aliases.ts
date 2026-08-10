export const FX_STABLECOIN_ALIASES: Record<string, string> = {
  USDT: "USD",
  USDC: "USD",
  BUSD: "USD",
  TUSD: "USD",
  FDUSD: "USD",
};

export function normalizeFxCurrency(code: string): string {
  const upper = code.trim().toUpperCase();
  return FX_STABLECOIN_ALIASES[upper] ?? upper;
}
