import type Database from "better-sqlite3";

import { fetchBtcBalance, resolveBtcTransaction } from "@/lib/wallets/btc";
import { fetchEthBalance, resolveEthTransaction } from "@/lib/wallets/eth";
import { classifyAmountMatch } from "@/lib/wallets/match";
import {
  getOrCreateWallet,
  listPendingTransfers,
  listWallets,
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
        // CDC batches many customer withdrawals into one tx. Closest-vout
        // invents false wallets — only link to BTC addresses the user added.
        const knownBtc = listWallets(db)
          .filter((wallet) => wallet.chain === "btc")
          .map((wallet) => wallet.address);
        if (knownBtc.length === 0) {
          updateTransferResolution(db, transfer.id, {
            walletId: null,
            onchainAmount: null,
            onchainStatus: "unresolved",
            notes:
              "Add your Bitcoin address, then scan — batch txs cannot invent the destination",
          });
          result.unresolved += 1;
          continue;
        }

        const resolved = await resolveBtcTransaction(
          transfer.txHash,
          transfer.amount,
          { fetchImpl, knownAddresses: knownBtc },
        );
        if (!resolved) {
          updateTransferResolution(db, transfer.id, {
            walletId: null,
            onchainAmount: null,
            onchainStatus: "unresolved",
            notes:
              "No output to your tracked Bitcoin address in this transaction",
          });
          result.unresolved += 1;
          continue;
        }
        const wallet = getOrCreateWallet(db, "btc", resolved.address);
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
          notes: match.notes ?? `Δ${resolved.deltaSats} sats`,
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
        updateWalletBalance(db, wallet.id, balance, "ETH", syncedAt);
      } else {
        const balance = await fetchBtcBalance(wallet.address, { fetchImpl });
        updateWalletBalance(db, wallet.id, balance, "BTC", syncedAt);
      }
      updated += 1;
    } catch {
      // Leave prior balance; page can show stale.
    }
  }
  return updated;
}
