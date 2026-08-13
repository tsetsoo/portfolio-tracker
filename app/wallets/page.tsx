import { WalletsManager } from "@/components/WalletsManager";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { getDb } from "@/lib/db/client";
import { costCoverageRatio } from "@/lib/wallets/cost-coverage";
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
    <Page>
      <PageHeader
        eyebrow="On-chain watch"
        title="Wallets"
        description="Track ETH/BTC/BCH addresses and ERC-20 balances. Wallet assets roll into overview net worth. Scan exchange withdrawal hashes to resolve destinations and attach FIFO cost."
      />

      <p className="mt-6 max-w-3xl text-[11px] leading-relaxed text-dim">
        Bitcoin is watch-only via account xpub (receive + change). Ethereum and
        Bitcoin Cash use a normal address. Import Crypto.com App history and
        Binance Withdraw History (with TxIDs) for FIFO cost on transfers. ERC-20
        tokens worth ≥ €10 (e.g. LINK) appear under ETH wallets after Refresh
        balances.
      </p>

      <div className="mt-5">
        <WalletsManager
          wallets={walletItems}
          transfersByWallet={transfersByWallet}
          unlinkedTransfers={allTransfers.filter(
            (transfer) => transfer.walletId == null,
          )}
          pendingCount={pendingCount}
        />
      </div>
    </Page>
  );
}
