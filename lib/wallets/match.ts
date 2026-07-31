import type { OnchainStatus, WalletChain } from "@/lib/wallets/types";

/** Native ETH withdrawals often deduct a small fee from the CSV amount. */
export const ETH_FEE_TOLERANCE = 0.01;

/** BTC exchange withdrawals often land ~fee below CSV amount (~40–60k sats). */
export const BTC_MATCH_SATS = 80_000;
export const BTC_WEAK_SATS = 200_000;

export function classifyAmountMatch(
  chain: WalletChain,
  csvAmount: number,
  onchainAmount: number,
): { status: Exclude<OnchainStatus, "pending" | "unresolved">; notes: string | null } {
  const delta = Math.abs(csvAmount - onchainAmount);

  if (chain === "eth") {
    if (delta <= ETH_FEE_TOLERANCE) {
      return {
        status: "matched",
        notes: delta > 0 ? `fee/delta ${delta}` : null,
      };
    }
    return {
      status: "mismatch",
      notes: `CSV ${csvAmount} vs on-chain ${onchainAmount}`,
    };
  }

  const deltaSats = Math.round(delta * 1e8);
  if (deltaSats <= BTC_MATCH_SATS) {
    return {
      status: "matched",
      notes: deltaSats > 0 ? `fee/delta ${deltaSats} sats` : null,
    };
  }
  if (deltaSats <= BTC_WEAK_SATS) {
    return {
      status: "weak",
      notes: `closest out Δ${deltaSats} sats`,
    };
  }
  return {
    status: "mismatch",
    notes: `CSV ${csvAmount} vs on-chain ${onchainAmount} (Δ${deltaSats} sats)`,
  };
}
