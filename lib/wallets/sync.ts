import type Database from "better-sqlite3";

import { fetchCoinGeckoQuote } from "@/lib/quotes/crypto-coingecko";
import { fetchFrankfurterRate } from "@/lib/quotes/fx-frankfurter";
import { getSettings } from "@/lib/settings";
import { fetchBchBalance } from "@/lib/wallets/bch";
import { fetchBtcBalance, resolveBtcTransaction } from "@/lib/wallets/btc";
import {
  ETH_TOKEN_MIN_VALUE_EUR,
  fetchEthBalance,
  fetchEthTokenBalances,
  resolveEthTransaction,
} from "@/lib/wallets/eth";
import { classifyAmountMatch } from "@/lib/wallets/match";
import {
  getBtcXpubWallet,
  getOrCreateWallet,
  listAddressesForWallet,
  listPendingTransfers,
  listWallets,
  replaceWalletTokenBalances,
  syncBtcDerivedAddresses,
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

async function addressHasHistory(
  address: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  for (const base of [
    "https://blockstream.info/api",
    "https://mempool.space/api",
  ]) {
    try {
      const response = await fetchImpl(`${base}/address/${address}`);
      if (!response.ok) continue;
      const body = (await response.json()) as {
        chain_stats?: { tx_count?: number };
      };
      return (body.chain_stats?.tx_count ?? 0) > 0;
    } catch {
      // try next explorer
    }
  }
  return false;
}

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

  const btcWallet = getBtcXpubWallet(db);
  let btcKnown = new Set<string>();
  if (btcWallet) {
    // Advance gap limit using which derived addresses already have history.
    const seed = new Set(listAddressesForWallet(db, btcWallet.id));
    const used = new Set<string>();
    for (const address of seed) {
      if (await addressHasHistory(address, fetchImpl)) used.add(address);
    }
    const expanded = syncBtcDerivedAddresses(db, btcWallet.id, used);
    btcKnown = new Set(expanded);
  }

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
        if (!btcWallet || btcKnown.size === 0) {
          updateTransferResolution(db, transfer.id, {
            walletId: null,
            onchainAmount: null,
            onchainStatus: "unresolved",
            notes: "Add a Bitcoin xpub to link withdrawals to your wallet",
          });
          result.unresolved += 1;
          continue;
        }

        const resolved = await resolveBtcTransaction(
          transfer.txHash,
          transfer.amount,
          { fetchImpl, knownAddresses: [...btcKnown] },
        );
        if (!resolved) {
          updateTransferResolution(db, transfer.id, {
            walletId: null,
            onchainAmount: null,
            onchainStatus: "unresolved",
            notes: "No output to an address derived from your xpub",
          });
          result.unresolved += 1;
          continue;
        }

        touched.add(btcWallet.id);
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
          walletId: btcWallet.id,
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

        const tokenBalances = await fetchEthTokenBalances(wallet.address, {
          fetchImpl,
        });
        const baseCurrency = getSettings(db).baseCurrency.toUpperCase();
        const kept: Array<{
          asset: string;
          balance: number;
          valueBase: number | null;
          valueCurrency: string | null;
        }> = [];
        for (const token of tokenBalances) {
          try {
            const quote = await fetchCoinGeckoQuote(
              token.asset,
              baseCurrency,
              fetchImpl,
            );
            let valueBase = token.balance * quote.price;
            let valueCurrency = quote.currency.toUpperCase();
            if (valueCurrency !== baseCurrency) {
              const fx = await fetchFrankfurterRate(
                valueCurrency,
                baseCurrency,
                fetchImpl,
              );
              valueBase *= fx;
              valueCurrency = baseCurrency;
            }
            let valueEur = valueBase;
            if (valueCurrency !== "EUR") {
              const toEur = await fetchFrankfurterRate(
                valueCurrency,
                "EUR",
                fetchImpl,
              );
              valueEur = valueBase * toEur;
            }
            if (valueEur + 1e-9 >= ETH_TOKEN_MIN_VALUE_EUR) {
              kept.push({
                asset: token.asset,
                balance: token.balance,
                valueBase,
                valueCurrency,
              });
            }
          } catch {
            if (token.balance > 0) {
              kept.push({
                asset: token.asset,
                balance: token.balance,
                valueBase: null,
                valueCurrency: null,
              });
            }
          }
        }
        replaceWalletTokenBalances(db, wallet.id, kept);
      } else if (wallet.chain === "bch") {
        const addresses = listAddressesForWallet(db, wallet.id);
        let total = 0;
        for (const address of addresses) {
          const balance = await fetchBchBalance(address, { fetchImpl });
          updateAddressBalance(db, wallet.id, address, balance);
          total += balance;
        }
        updateWalletBalance(db, wallet.id, total, "BCH", syncedAt);
      } else {
        let addresses = listAddressesForWallet(db, wallet.id);
        if (wallet.xpub) {
          const used = new Set<string>();
          for (const address of addresses) {
            if (await addressHasHistory(address, fetchImpl)) used.add(address);
          }
          addresses = syncBtcDerivedAddresses(db, wallet.id, used);
        }
        let total = 0;
        // Pace public explorers only for real network fetches (not unit-test mocks).
        const throttleMs = options.fetchImpl ? 0 : 400;
        for (const address of addresses) {
          const balance = await fetchBtcBalance(address, {
            fetchImpl,
            throttleMs,
          });
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
