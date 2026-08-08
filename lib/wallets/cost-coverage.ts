import type { WalletTransfer } from "@/lib/wallets/types";

/** Fraction of on-chain balance covered by costed/partial transfers (0–1). */
export function costCoverageRatio(
  balance: number | null | undefined,
  transfers: WalletTransfer[],
  asset?: string | null,
): number {
  if (balance == null || balance <= 0) return 0;
  const relevant = asset
    ? transfers.filter((t) => t.asset.toUpperCase() === asset.toUpperCase())
    : transfers;
  const covered = relevant.reduce((sum, transfer) => {
    if (
      transfer.costStatus === "costed" ||
      transfer.costStatus === "partial" ||
      transfer.costStatus === "gift"
    ) {
      return sum + transfer.amount;
    }
    return sum;
  }, 0);
  return Math.min(1, covered / balance);
}

export function formatCostCoveragePercent(ratio: number): string {
  return `${Math.round(ratio * 100)}% costed`;
}
