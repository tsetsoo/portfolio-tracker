export type WalletChain = "eth" | "btc";

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
  address: string;
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
};

export type CryptoComWithdrawalRow = {
  chain: WalletChain;
  asset: string;
  amount: number;
  txHash: string;
  transferredAt: string;
};
