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
  // Binance BTC hot wallet
  {
    venue: "binance",
    chain: "btc",
    address: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
  },
  // Binance ETH hot wallets observed funding this portfolio
  {
    venue: "binance",
    chain: "eth",
    address: "0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549",
  },
  {
    venue: "binance",
    chain: "eth",
    address: "0x9696f59E4d72E237BE84fFD425DCaD154Bf96976",
  },
  {
    venue: "binance",
    chain: "eth",
    address: "0x4976A4A02f38326660D17bf34b431dC6e2eb2327",
  },
  // Crypto.com BTC
  {
    venue: "cryptocom",
    chain: "btc",
    address: "bc1q7cyrfmck2ffu2ud3rn5l5a8yv6f0chkp0zpemf",
  },
  // Crypto.com ETH
  {
    venue: "cryptocom",
    chain: "eth",
    address: "0x46340b20830761efd32832A74d7169B29FEB9758",
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
    return `Binance → Wallet → Withdraw History → export CSV around ${when} for ~${qty} ${input.asset} (includes TxID). Ledger Transaction History omits txids.`;
  }
  return `Check each exchange’s withdrawal history around ${when} for ~${qty} ${input.asset}, then re-import the CSV (or set cost/gift on the transfer).`;
}
