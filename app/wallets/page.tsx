import { WalletsManager } from "@/components/WalletsManager";
import { getDb } from "@/lib/db/client";
import {
  costCoverageRatio,
} from "@/lib/wallets/cost-coverage";
import {
  countTransfersByWallet,
  listTokenBalancesForWallet,
  listWalletTransfers,
  listWallets,
} from "@/lib/wallets/repo";
import type { WalletTransfer } from "@/lib/wallets/types";

export const dynamic = "force-dynamic";

export default function WalletsPage() {
  const db = getDb();
  const wallets = listWallets(db);
  const counts = countTransfersByWallet(db);
  const allTransfers = listWalletTransfers(db);
  const transfersByWallet: Record<string, WalletTransfer[]> = {};
  for (const transfer of allTransfers) {
    if (!transfer.walletId) continue;
    const list = transfersByWallet[transfer.walletId] ?? [];
    list.push(transfer);
    transfersByWallet[transfer.walletId] = list;
  }
  const pendingCount = allTransfers.filter(
    (transfer) =>
      transfer.walletId == null ||
      transfer.onchainStatus === "pending" ||
      transfer.onchainStatus === "unresolved",
  ).length;

  const walletItems = wallets.map((wallet) => {
    const stats = counts.get(wallet.id) ?? { total: 0, mismatches: 0 };
    const transfers = transfersByWallet[wallet.id] ?? [];
    return {
      ...wallet,
      transferCount: stats.total,
      mismatchCount: stats.mismatches,
      tokens: listTokenBalancesForWallet(db, wallet.id),
      costCoverage: costCoverageRatio(
        wallet.balance,
        transfers,
        wallet.balanceAsset,
      ),
    };
  });

  return (
    <main className="dashboard management-page">
      <header className="page-header">
        <p className="eyebrow">On-chain watch</p>
        <h1>Wallets</h1>
        <p>
          Track ETH/BTC/BCH addresses separately from portfolio value. Scan
          exchange withdrawal hashes to resolve destinations, attach FIFO cost,
          and surface significant ERC-20 balances.
        </p>
      </header>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Not in net worth</p>
            <h2>Tracked addresses</h2>
          </div>
          <span>
            {walletItems.length}{" "}
            {walletItems.length === 1 ? "wallet" : "wallets"}
          </span>
        </div>
        <p className="section-note">
          Bitcoin is watch-only via account xpub (receive + change). Ethereum
          and Bitcoin Cash use a normal address. Import Crypto.com App history
          and Binance Withdraw History (with TxIDs) for FIFO cost on transfers.
          ERC-20 tokens worth ≥ €10 (e.g. LINK) appear under ETH wallets after
          Refresh balances.
        </p>
        <WalletsManager
          wallets={walletItems}
          transfersByWallet={transfersByWallet}
          unlinkedTransfers={allTransfers.filter(
            (transfer) => transfer.walletId == null,
          )}
          pendingCount={pendingCount}
        />
      </section>
    </main>
  );
}
