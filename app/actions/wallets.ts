"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/lib/db/client";
import {
  addBchAddress,
  consolidateBchWallets,
  countTransfersByWallet,
  createManualWallet,
  deleteWallet,
  listTokenBalancesForWallet,
  listWalletTransfers,
  listWallets,
  markOrphanInflowAsGift,
  setBtcXpubWallet,
  updateTransferCost,
  updateWalletLabel,
} from "@/lib/wallets/repo";
import { costCoverageRatio } from "@/lib/wallets/cost-coverage";
import { findOrphanInflows } from "@/lib/wallets/orphans";
import {
  refreshWalletBalances,
  scanWalletWithdrawals,
  type ScanWithdrawalsResult,
} from "@/lib/wallets/sync";
import type {
  OrphanInflow,
  TransferCostStatus,
  Wallet,
  WalletChain,
  WalletTokenBalance,
  WalletTransfer,
} from "@/lib/wallets/types";
import { isValidBchAddress, normalizeBchAddress } from "@/lib/wallets/bch";
import {
  resolveBtcScriptType,
  type BtcScriptType,
} from "@/lib/wallets/xpub";

export type WalletListItem = Wallet & {
  transferCount: number;
  mismatchCount: number;
  tokens: WalletTokenBalance[];
  costCoverage: number;
};

function revalidateWallets() {
  revalidatePath("/wallets");
}

export async function listTrackedWallets(): Promise<WalletListItem[]> {
  const db = getDb();
  const counts = countTransfersByWallet(db);
  const transfers = listWalletTransfers(db);
  return listWallets(db).map((wallet) => {
    const stats = counts.get(wallet.id) ?? { total: 0, mismatches: 0 };
    const walletTransfers = transfers.filter((t) => t.walletId === wallet.id);
    return {
      ...wallet,
      transferCount: stats.total,
      mismatchCount: stats.mismatches,
      tokens: listTokenBalancesForWallet(db, wallet.id),
      costCoverage: costCoverageRatio(
        wallet.balance,
        walletTransfers,
        wallet.balanceAsset,
      ),
    };
  });
}

export async function markTransferGiftAction(transferId: string): Promise<void> {
  updateTransferCost(getDb(), transferId, {
    costBasis: null,
    costCurrency: null,
    costStatus: "gift",
    costNotes: "Marked as gift / unknown source",
  });
  revalidateWallets();
}

export async function markOrphanGiftAction(orphan: {
  chain: WalletChain;
  asset: string;
  amount: number;
  txHash: string;
  transferredAt: string;
  toAddress: string;
}): Promise<WalletTransfer> {
  const transfer = markOrphanInflowAsGift(getDb(), orphan);
  revalidateWallets();
  return transfer;
}

export async function setTransferManualCostAction(
  transferId: string,
  costBasis: number,
  costCurrency: string,
): Promise<void> {
  if (!Number.isFinite(costBasis) || costBasis < 0) {
    throw new Error("Invalid cost basis");
  }
  const currency = costCurrency.trim().toUpperCase();
  if (!currency) throw new Error("Cost currency required");
  updateTransferCost(getDb(), transferId, {
    costBasis,
    costCurrency: currency,
    costStatus: "costed" satisfies TransferCostStatus,
    costNotes: "Manual cost override",
  });
  revalidateWallets();
}

export async function listTransfersForWallet(
  walletId: string,
): Promise<WalletTransfer[]> {
  return listWalletTransfers(getDb(), walletId);
}

export async function listUnresolvedTransfers(): Promise<WalletTransfer[]> {
  return listWalletTransfers(getDb()).filter(
    (transfer) =>
      transfer.walletId == null ||
      transfer.onchainStatus === "pending" ||
      transfer.onchainStatus === "unresolved",
  );
}

export async function scanWithdrawalsAction(): Promise<
  ScanWithdrawalsResult & { orphans: OrphanInflow[] }
> {
  const result = await scanWalletWithdrawals(getDb());
  const orphans = await findOrphanInflows(getDb());
  revalidateWallets();
  return { ...result, orphans };
}

export async function findMissingInflowsAction(): Promise<OrphanInflow[]> {
  return findOrphanInflows(getDb());
}

export async function refreshBalancesAction(): Promise<{ updated: number }> {
  const updated = await refreshWalletBalances(getDb());
  revalidateWallets();
  return { updated };
}

export async function addEthWalletAction(input: {
  address: string;
  label?: string;
}): Promise<Wallet> {
  const address = input.address.trim();
  if (!address) throw new Error("Address is required");
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("Invalid Ethereum address");
  }
  const wallet = createManualWallet(getDb(), "eth", address, input.label ?? null);
  try {
    await refreshWalletBalances(getDb(), { walletIds: [wallet.id] });
  } catch {
    // Balance optional on add
  }
  revalidateWallets();
  return wallet;
}

export async function addBchWalletAction(input: {
  address: string;
  label?: string;
}): Promise<Wallet> {
  const address = normalizeBchAddress(input.address);
  if (!address) throw new Error("Address is required");
  if (!isValidBchAddress(address)) {
    throw new Error("Invalid Bitcoin Cash address");
  }
  const db = getDb();
  // Collapse any prior one-address BCH rows, then attach.
  consolidateBchWallets(db);
  const wallet = addBchAddress(db, address, input.label ?? null);
  try {
    await refreshWalletBalances(db, { walletIds: [wallet.id] });
  } catch {
    // Balance optional on add
  }
  revalidateWallets();
  return wallet;
}

/** @deprecated use addEthWalletAction / setBtcXpubAction */
export async function addWalletAction(input: {
  chain: WalletChain;
  address: string;
  label?: string;
}): Promise<Wallet> {
  if (input.chain === "btc") {
    throw new Error("Use setBtcXpubAction for Bitcoin (paste an xpub/zpub)");
  }
  return addEthWalletAction({
    address: input.address,
    label: input.label,
  });
}

export async function setBtcXpubAction(input: {
  xpub: string;
  label?: string;
  /** When omitted, zpub/ypub are unambiguous; bare xpub is probed on-chain. */
  scriptType?: BtcScriptType | "auto";
}): Promise<Wallet> {
  const scriptType =
    input.scriptType && input.scriptType !== "auto"
      ? input.scriptType
      : await resolveBtcScriptType(input.xpub);
  const wallet = setBtcXpubWallet(
    getDb(),
    input.xpub,
    input.label ?? null,
    scriptType,
  );
  try {
    await refreshWalletBalances(getDb(), { walletIds: [wallet.id] });
  } catch {
    // Balance optional on add
  }
  revalidateWallets();
  return wallet;
}

export async function renameWalletAction(
  id: string,
  label: string,
): Promise<void> {
  updateWalletLabel(getDb(), id, label);
  revalidateWallets();
}

export async function removeWalletAction(id: string): Promise<void> {
  deleteWallet(getDb(), id);
  revalidateWallets();
}
