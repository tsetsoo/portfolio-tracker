import type Database from "better-sqlite3";

import { fetchBtcBalance, resolveBtcTransaction } from "@/lib/wallets/btc";
import { fetchEthBalance, resolveEthTransaction } from "@/lib/wallets/eth";
import { classifyAmountMatch } from "@/lib/wallets/match";
import {
  attachBtcAddress,
  consolidateBtcWallets,
  getOrCreateWallet,
  listPendingTransfers,
  listWallets,
  updateAddressBalance,
  updateTransferResolution,
  updateWalletBalance,
} from "@/lib/wallets/repo";

export type ScanWithdrawalsResult = {
  resolved: number;
  matched: number;
  mismatched: number;
  weak: number;
  unresolved: number;
  walletsTouched: number;
};

export async function scanWalletWithdrawals(
  db: Database.Database,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<ScanWithdrawalsResult> {
  consolidateBtcWallets(db);
  const pending = listPendingTransfers(db);
  const fetchImpl = options.fetchImpl ?? fetch;
  const touched = new Set<string>();
  const result: ScanWithdrawalsResult = {
    resolved: 0,
    matched: 0,
    mismatched: 0,
    weak: 0,
    unresolved: 0,
    walletsTouched: 0,
  };

  for (const transfer of pending) {
    try {
      if (transfer.chain === "eth") {
        const resolved = await resolveEthTransaction(transfer.txHash, {
          fetchImpl,
          expectedAsset: transfer.asset,
        });
        if (!resolved) {
          updateTransferResolution(db, transfer.id, {
            walletId: transfer.walletId,
            onchainAmount: null,
            onchainStatus: "unresolved",
            notes: "Transaction not found on Ethereum",
          });
          result.unresolved += 1;
          continue;
        }
        const wallet = getOrCreateWallet(db, "eth", resolved.address);
        touched.add(wallet.id);
        const match = classifyAmountMatch(
          "eth",
          transfer.amount,
          resolved.amount,
        );
        updateTransferResolution(db, transfer.id, {
          walletId: wallet.id,
          onchainAmount: resolved.amount,
          onchainStatus: match.status,
          notes: match.notes,
        });
        result.resolved += 1;
        if (match.status === "matched") result.matched += 1;
        else if (match.status === "mismatch") result.mismatched += 1;
        else if (match.status === "weak") result.weak += 1;
      } else {
        const resolved = await resolveBtcTransaction(
          transfer.txHash,
          transfer.amount,
          { fetchImpl },
        );
        if (!resolved) {
          updateTransferResolution(db, transfer.id, {
            walletId: transfer.walletId,
            onchainAmount: null,
            onchainStatus: "unresolved",
            notes: "Transaction not found on Bitcoin",
          });
          result.unresolved += 1;
          continue;
        }
        // Auto-discover receive address; fold into the single BTC wallet.
        const wallet = attachBtcAddress(db, resolved.address);
        touched.add(wallet.id);
        const match =
          resolved.confidence === "mismatch"
            ? {
                status: "mismatch" as const,
                notes: `closest out Δ${resolved.deltaSats} sats`,
              }
            : classifyAmountMatch("btc", transfer.amount, resolved.amount);
        const status =
          resolved.confidence === "weak" ? "weak" : match.status;
        updateTransferResolution(db, transfer.id, {
          walletId: wallet.id,
          onchainAmount: resolved.amount,
          onchainStatus: status,
          notes: match.notes ?? `Δ${resolved.deltaSats} sats · ${resolved.address}`,
        });
        result.resolved += 1;
        if (status === "matched") result.matched += 1;
        else if (status === "mismatch") result.mismatched += 1;
        else if (status === "weak") result.weak += 1;
      }
    } catch (error) {
      updateTransferResolution(db, transfer.id, {
        walletId: transfer.walletId,
        onchainAmount: null,
        onchainStatus: "unresolved",
        notes:
          error instanceof Error ? error.message : "Failed to resolve transfer",
      });
      result.unresolved += 1;
    }
  }

  await refreshWalletBalances(db, { fetchImpl, walletIds: [...touched] });
  result.walletsTouched = touched.size;
  return result;
}

export async function refreshWalletBalances(
  db: Database.Database,
  options: {
    fetchImpl?: typeof fetch;
    walletIds?: string[];
  } = {},
): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wallets = listWallets(db).filter((wallet) =>
    options.walletIds ? options.walletIds.includes(wallet.id) : true,
  );
  const syncedAt = new Date().toISOString();
  let updated = 0;
  for (const wallet of wallets) {
    try {
      if (wallet.chain === "eth") {
        const balance = await fetchEthBalance(wallet.address, { fetchImpl });
        updateAddressBalance(db, wallet.id, wallet.address, balance);
        updateWalletBalance(db, wallet.id, balance, "ETH", syncedAt);
      } else {
        let total = 0;
        for (const address of wallet.addresses) {
          const balance = await fetchBtcBalance(address, { fetchImpl });
          updateAddressBalance(db, wallet.id, address, balance);
          total += balance;
        }
        updateWalletBalance(db, wallet.id, total, "BTC", syncedAt);
      }
      updated += 1;
    } catch {
      // Leave prior balance; page can show stale.
    }
  }
  return updated;
}
