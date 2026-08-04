export type WalletChain = "eth" | "btc" | "bch";

export type OnchainStatus =
  | "pending"
  | "matched"
  | "mismatch"
  | "unresolved"
  | "weak";

export type WalletTransferSource = "cryptocom" | "manual";

export type Wallet = {
  id: string;
  chain: WalletChain;
  /** Primary / display address (first receive, or ETH address). */
  address: string;
  /** Derived / known addresses for this wallet. */
  addresses: string[];
  /** Watch-only account xpub/ypub/zpub for BTC. */
  xpub: string | null;
  scriptType: "p2wpkh" | "p2sh-p2wpkh" | "p2pkh" | null;
  label: string | null;
  balance: number | null;
  balanceAsset: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
};

export type WalletTransfer = {
  id: string;
  walletId: string | null;
  chain: WalletChain;
  asset: string;
  amount: number;
  txHash: string;
  transferredAt: string;
  source: WalletTransferSource;
  importBatchId: string | null;
  onchainAmount: number | null;
  onchainStatus: OnchainStatus;
  notes: string | null;
  /** FIFO cost of coins withdrawn from exchange lots (when known). */
  costBasis: number | null;
  costCurrency: string | null;
};

export type CryptoComWithdrawalRow = {
  chain: WalletChain;
  asset: string;
  amount: number;
  txHash: string;
  transferredAt: string;
  costBasis?: number | null;
  costCurrency?: string | null;
};

/** Inbound on-chain transfer with no matching imported withdrawal. */
export type OrphanInflow = {
  chain: WalletChain;
  asset: string;
  amount: number;
  txHash: string;
  transferredAt: string;
  toAddress: string;
  fromAddress: string | null;
  guessedVenue: "cryptocom" | "binance" | "unknown";
  searchHint: string;
};
