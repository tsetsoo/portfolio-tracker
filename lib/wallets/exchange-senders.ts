import type { WalletChain } from "@/lib/wallets/types";

export type ExchangeVenue = "cryptocom" | "binance" | "unknown";

/**
 * Best-effort hot / deposit-cluster addresses seen funding personal wallets.
 * Not exhaustive — unknown senders still surface as orphans with a generic hint.
 */
const KNOWN_SENDERS: Array<{
  venue: Exclude<ExchangeVenue, "unknown">;
  chain: WalletChain;
  address: string;
}> = [
  // Binance BTC hot wallet (common funding source for withdrawals)
  {
    venue: "binance",
    chain: "btc",
    address: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
  },
];

export function normalizeSenderAddress(
  chain: WalletChain,
  address: string,
): string {
  const trimmed = address.trim();
  return chain === "eth" ? trimmed.toLowerCase() : trimmed;
}

export function guessExchangeVenue(
  chain: WalletChain,
  fromAddress: string | null | undefined,
): ExchangeVenue {
  if (!fromAddress) return "unknown";
  const normalized = normalizeSenderAddress(chain, fromAddress);
  for (const row of KNOWN_SENDERS) {
    if (row.chain !== chain) continue;
    if (normalizeSenderAddress(chain, row.address) === normalized) {
      return row.venue;
    }
  }
  return "unknown";
}

export function orphanSearchHint(input: {
  venue: ExchangeVenue;
  asset: string;
  amount: number;
  transferredAt: string;
}): string {
  const qty = new Intl.NumberFormat("en", {
    maximumFractionDigits: 8,
  }).format(input.amount);
  const when = input.transferredAt.slice(0, 10);

  if (input.venue === "cryptocom") {
    return `Crypto.com app → Transactions → filter Withdrawals around ${when} for ~${qty} ${input.asset}. Re-export CSV if the row is missing.`;
  }
  if (input.venue === "binance") {
    return `Binance → Wallet → Transaction History → Withdrawal around ${when} for ~${qty} ${input.asset}. Ledger CSV often omits txids — check the web history.`;
  }
  return `Check each exchange’s withdrawal history around ${when} for ~${qty} ${input.asset}, then re-import the CSV (or add the tx manually).`;
}
