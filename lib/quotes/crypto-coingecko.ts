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
};

type CoinGeckoResponse = Record<string, Record<string, number>>;

export async function fetchCoinGeckoQuote(
  symbol: string,
  baseCurrency: string,
  fetchImpl: typeof fetch,
): Promise<{ price: number; currency: string }> {
  const id = COINGECKO_IDS[symbol];
  if (!id) {
    throw new Error(`Unsupported crypto symbol: ${symbol}`);
  }

  const preferredCurrency = baseCurrency.toUpperCase() === "EUR" ? "eur" : "usd";
  const url =
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}` +
    "&vs_currencies=eur,usd";
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`CoinGecko request failed (${response.status})`);
  }

  const payload = (await response.json()) as CoinGeckoResponse;
  const prices = payload[id];
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
