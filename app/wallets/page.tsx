import { WalletsManager } from "@/components/WalletsManager";
import { getDb } from "@/lib/db/client";
import {
  countTransfersByWallet,
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
    return {
      ...wallet,
      transferCount: stats.total,
      mismatchCount: stats.mismatches,
    };
  });

  return (
    <main className="dashboard management-page">
      <header className="page-header">
        <p className="eyebrow">On-chain watch</p>
        <h1>Wallets</h1>
        <p>
          Track ETH/BTC addresses separately from portfolio value. Scan
          Crypto.com withdrawal hashes to resolve destinations and flag amount
          mismatches.
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
          Scan discovers withdrawal destinations. Multiple Bitcoin receive
          addresses are combined into one BTC wallet (balance summed). Binance
          ledger withdrawals have no tx hashes and cannot be linked yet.
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
