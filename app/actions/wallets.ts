"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/lib/db/client";
import {
  countTransfersByWallet,
  createManualWallet,
  deleteWallet,
  listWalletTransfers,
  listWallets,
  updateWalletLabel,
} from "@/lib/wallets/repo";
import {
  refreshWalletBalances,
  scanWalletWithdrawals,
  type ScanWithdrawalsResult,
} from "@/lib/wallets/sync";
import type { Wallet, WalletChain, WalletTransfer } from "@/lib/wallets/types";

export type WalletListItem = Wallet & {
  transferCount: number;
  mismatchCount: number;
};

function revalidateWallets() {
  revalidatePath("/wallets");
}

export async function listTrackedWallets(): Promise<WalletListItem[]> {
  const db = getDb();
  const counts = countTransfersByWallet(db);
  return listWallets(db).map((wallet) => {
    const stats = counts.get(wallet.id) ?? { total: 0, mismatches: 0 };
    return {
      ...wallet,
      transferCount: stats.total,
      mismatchCount: stats.mismatches,
    };
  });
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

export async function scanWithdrawalsAction(): Promise<ScanWithdrawalsResult> {
  const result = await scanWalletWithdrawals(getDb());
  revalidateWallets();
  return result;
}

export async function refreshBalancesAction(): Promise<{ updated: number }> {
  const updated = await refreshWalletBalances(getDb());
  revalidateWallets();
  return { updated };
}

export async function addWalletAction(input: {
  chain: WalletChain;
  address: string;
  label?: string;
}): Promise<Wallet> {
  const address = input.address.trim();
  if (!address) throw new Error("Address is required");
  if (input.chain === "eth" && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("Invalid Ethereum address");
  }
  if (
    input.chain === "btc" &&
    !/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(address)
  ) {
    throw new Error("Invalid Bitcoin address");
  }
  const wallet = createManualWallet(
    getDb(),
    input.chain,
    address,
    input.label ?? null,
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
