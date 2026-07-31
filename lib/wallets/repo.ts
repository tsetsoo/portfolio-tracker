import crypto from "node:crypto";
import type Database from "better-sqlite3";

import type {
  CryptoComWithdrawalRow,
  OnchainStatus,
  Wallet,
  WalletChain,
  WalletTransfer,
  WalletTransferSource,
} from "@/lib/wallets/types";

type WalletRow = {
  id: string;
  chain: WalletChain;
  address: string;
  label: string | null;
  balance: number | null;
  balance_asset: string | null;
  created_at: string;
  last_synced_at: string | null;
};

type TransferRow = {
  id: string;
  wallet_id: string | null;
  chain: WalletChain;
  asset: string;
  amount: number;
  tx_hash: string;
  transferred_at: string;
  source: WalletTransferSource;
  import_batch_id: string | null;
  onchain_amount: number | null;
  onchain_status: OnchainStatus;
  notes: string | null;
};

function mapWallet(row: WalletRow, addresses: string[]): Wallet {
  const list = addresses.length > 0 ? addresses : [row.address];
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    addresses: list,
    label: row.label,
    balance: row.balance,
    balanceAsset: row.balance_asset,
    createdAt: row.created_at,
    lastSyncedAt: row.last_synced_at,
  };
}

function mapTransfer(row: TransferRow): WalletTransfer {
  return {
    id: row.id,
    walletId: row.wallet_id,
    chain: row.chain,
    asset: row.asset,
    amount: row.amount,
    txHash: row.tx_hash,
    transferredAt: row.transferred_at,
    source: row.source,
    importBatchId: row.import_batch_id,
    onchainAmount: row.onchain_amount,
    onchainStatus: row.onchain_status,
    notes: row.notes,
  };
}

function normalizeAddress(chain: WalletChain, address: string): string {
  const trimmed = address.trim();
  return chain === "eth" ? trimmed.toLowerCase() : trimmed;
}

function normalizeTxHash(chain: WalletChain, txHash: string): string {
  const trimmed = txHash.trim();
  if (chain === "eth") {
    const lower = trimmed.toLowerCase();
    return lower.startsWith("0x") ? lower : `0x${lower}`;
  }
  return trimmed.toLowerCase();
}

function listAddressesForWallet(
  db: Database.Database,
  walletId: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT address FROM wallet_addresses WHERE wallet_id = ? ORDER BY address`,
    )
    .all(walletId) as Array<{ address: string }>;
  return rows.map((row) => row.address);
}

function ensureWalletAddress(
  db: Database.Database,
  walletId: string,
  address: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO wallet_addresses (id, wallet_id, address, balance)
     VALUES (?, ?, ?, NULL)`,
  ).run(crypto.randomUUID(), walletId, address);
}

function findWalletIdByAddress(
  db: Database.Database,
  address: string,
): string | null {
  const row = db
    .prepare(`SELECT wallet_id AS walletId FROM wallet_addresses WHERE address = ?`)
    .get(address) as { walletId: string } | undefined;
  return row?.walletId ?? null;
}

function getWalletRow(
  db: Database.Database,
  id: string,
): WalletRow | undefined {
  return db
    .prepare(
      `SELECT id, chain, address, label, balance, balance_asset, created_at, last_synced_at
       FROM wallets WHERE id = ?`,
    )
    .get(id) as WalletRow | undefined;
}

export function listWallets(db: Database.Database): Wallet[] {
  const rows = db
    .prepare(
      `SELECT id, chain, address, label, balance, balance_asset, created_at, last_synced_at
       FROM wallets
       ORDER BY chain, address`,
    )
    .all() as WalletRow[];
  return rows.map((row) => mapWallet(row, listAddressesForWallet(db, row.id)));
}

export function listWalletTransfers(
  db: Database.Database,
  walletId?: string,
): WalletTransfer[] {
  if (walletId) {
    const rows = db
      .prepare(
        `SELECT id, wallet_id, chain, asset, amount, tx_hash, transferred_at,
                source, import_batch_id, onchain_amount, onchain_status, notes
         FROM wallet_transfers
         WHERE wallet_id = ?
         ORDER BY transferred_at DESC, id`,
      )
      .all(walletId) as TransferRow[];
    return rows.map(mapTransfer);
  }
  const rows = db
    .prepare(
      `SELECT id, wallet_id, chain, asset, amount, tx_hash, transferred_at,
              source, import_batch_id, onchain_amount, onchain_status, notes
       FROM wallet_transfers
       ORDER BY transferred_at DESC, id`,
    )
    .all() as TransferRow[];
  return rows.map(mapTransfer);
}

export function listPendingTransfers(db: Database.Database): WalletTransfer[] {
  const rows = db
    .prepare(
      `SELECT id, wallet_id, chain, asset, amount, tx_hash, transferred_at,
              source, import_batch_id, onchain_amount, onchain_status, notes
       FROM wallet_transfers
       WHERE onchain_status IN ('pending','unresolved','weak')
          OR wallet_id IS NULL
       ORDER BY transferred_at ASC`,
    )
    .all() as TransferRow[];
  return rows.map(mapTransfer);
}

export function getOrCreateWallet(
  db: Database.Database,
  chain: WalletChain,
  address: string,
  label?: string | null,
): Wallet {
  if (chain === "btc") {
    return attachBtcAddress(db, address, label);
  }

  const normalized = normalizeAddress(chain, address);
  const byAddress = findWalletIdByAddress(db, normalized);
  if (byAddress) {
    const row = getWalletRow(db, byAddress);
    if (row) return mapWallet(row, listAddressesForWallet(db, row.id));
  }

  const existing = db
    .prepare(
      `SELECT id, chain, address, label, balance, balance_asset, created_at, last_synced_at
       FROM wallets WHERE chain = ? AND address = ?`,
    )
    .get(chain, normalized) as WalletRow | undefined;
  if (existing) {
    ensureWalletAddress(db, existing.id, normalized);
    return mapWallet(existing, listAddressesForWallet(db, existing.id));
  }

  const wallet: Wallet = {
    id: crypto.randomUUID(),
    chain,
    address: normalized,
    addresses: [normalized],
    label: label?.trim() || null,
    balance: null,
    balanceAsset: null,
    createdAt: new Date().toISOString(),
    lastSyncedAt: null,
  };
  db.prepare(
    `INSERT INTO wallets
       (id, chain, address, label, balance, balance_asset, created_at, last_synced_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL)`,
  ).run(wallet.id, wallet.chain, wallet.address, wallet.label, wallet.createdAt);
  ensureWalletAddress(db, wallet.id, normalized);
  return wallet;
}

/**
 * Auto-discovered and manual BTC receive addresses fold into one Bitcoin wallet
 * (HD wallets generate a new address per deposit).
 */
export function attachBtcAddress(
  db: Database.Database,
  address: string,
  label?: string | null,
): Wallet {
  const normalized = normalizeAddress("btc", address);
  const existingId = findWalletIdByAddress(db, normalized);
  if (existingId) {
    const row = getWalletRow(db, existingId)!;
    return mapWallet(row, listAddressesForWallet(db, row.id));
  }

  const btcWallets = db
    .prepare(
      `SELECT id, chain, address, label, balance, balance_asset, created_at, last_synced_at
       FROM wallets WHERE chain = 'btc' ORDER BY created_at ASC, id ASC`,
    )
    .all() as WalletRow[];

  if (btcWallets.length === 0) {
    const wallet: Wallet = {
      id: crypto.randomUUID(),
      chain: "btc",
      address: normalized,
      addresses: [normalized],
      label: label?.trim() || null,
      balance: null,
      balanceAsset: null,
      createdAt: new Date().toISOString(),
      lastSyncedAt: null,
    };
    db.prepare(
      `INSERT INTO wallets
         (id, chain, address, label, balance, balance_asset, created_at, last_synced_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL)`,
    ).run(
      wallet.id,
      wallet.chain,
      wallet.address,
      wallet.label,
      wallet.createdAt,
    );
    ensureWalletAddress(db, wallet.id, normalized);
    return wallet;
  }

  // Merge any accidental extra BTC wallets into the oldest one, then attach.
  const primary = btcWallets[0]!;
  for (const extra of btcWallets.slice(1)) {
    mergeWalletInto(db, extra.id, primary.id);
  }
  ensureWalletAddress(db, primary.id, normalized);
  if (label?.trim() && !primary.label) {
    db.prepare(`UPDATE wallets SET label = ? WHERE id = ?`).run(
      label.trim(),
      primary.id,
    );
  }
  const row = getWalletRow(db, primary.id)!;
  return mapWallet(row, listAddressesForWallet(db, row.id));
}

function mergeWalletInto(
  db: Database.Database,
  fromId: string,
  intoId: string,
): void {
  if (fromId === intoId) return;
  db.transaction(() => {
    const addresses = listAddressesForWallet(db, fromId);
    for (const address of addresses) {
      // Move address: delete then insert to satisfy UNIQUE(address).
      db.prepare(`DELETE FROM wallet_addresses WHERE wallet_id = ? AND address = ?`).run(
        fromId,
        address,
      );
      ensureWalletAddress(db, intoId, address);
    }
    db.prepare(
      `UPDATE wallet_transfers SET wallet_id = ? WHERE wallet_id = ?`,
    ).run(intoId, fromId);
    db.prepare(`DELETE FROM wallets WHERE id = ?`).run(fromId);
  })();
}

/** Collapse multiple BTC wallet rows into one (receive addresses preserved). */
export function consolidateBtcWallets(db: Database.Database): Wallet | null {
  const btcWallets = db
    .prepare(
      `SELECT id, chain, address, label, balance, balance_asset, created_at, last_synced_at
       FROM wallets WHERE chain = 'btc' ORDER BY created_at ASC, id ASC`,
    )
    .all() as WalletRow[];
  if (btcWallets.length === 0) return null;
  const primary = btcWallets[0]!;
  for (const extra of btcWallets.slice(1)) {
    mergeWalletInto(db, extra.id, primary.id);
  }
  const row = getWalletRow(db, primary.id)!;
  return mapWallet(row, listAddressesForWallet(db, row.id));
}

export function createManualWallet(
  db: Database.Database,
  chain: WalletChain,
  address: string,
  label?: string | null,
): Wallet {
  return getOrCreateWallet(db, chain, address, label);
}

export function updateWalletLabel(
  db: Database.Database,
  id: string,
  label: string | null,
): void {
  db.prepare(`UPDATE wallets SET label = ? WHERE id = ?`).run(
    label?.trim() || null,
    id,
  );
}

export function updateWalletBalance(
  db: Database.Database,
  id: string,
  balance: number,
  balanceAsset: string,
  syncedAt: string,
): void {
  db.prepare(
    `UPDATE wallets
     SET balance = ?, balance_asset = ?, last_synced_at = ?
     WHERE id = ?`,
  ).run(balance, balanceAsset, syncedAt, id);
}

export function updateAddressBalance(
  db: Database.Database,
  walletId: string,
  address: string,
  balance: number,
): void {
  db.prepare(
    `UPDATE wallet_addresses SET balance = ? WHERE wallet_id = ? AND address = ?`,
  ).run(balance, walletId, address);
}

export function deleteWallet(db: Database.Database, id: string): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE wallet_transfers SET wallet_id = NULL WHERE wallet_id = ?`,
    ).run(id);
    db.prepare(`DELETE FROM wallet_addresses WHERE wallet_id = ?`).run(id);
    db.prepare(`DELETE FROM wallets WHERE id = ?`).run(id);
  })();
}

export function upsertWalletTransfersFromWithdrawals(
  db: Database.Database,
  withdrawals: CryptoComWithdrawalRow[],
  options: { importBatchId?: string | null; source?: WalletTransferSource } = {},
): { upserted: number } {
  const source = options.source ?? "cryptocom";
  const insert = db.prepare(
    `INSERT INTO wallet_transfers
       (id, wallet_id, chain, asset, amount, tx_hash, transferred_at, source,
        import_batch_id, onchain_amount, onchain_status, notes)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', NULL)
     ON CONFLICT(tx_hash) DO UPDATE SET
       amount = excluded.amount,
       asset = excluded.asset,
       transferred_at = excluded.transferred_at,
       import_batch_id = COALESCE(excluded.import_batch_id, wallet_transfers.import_batch_id)`,
  );

  let upserted = 0;
  for (const row of withdrawals) {
    const txHash = normalizeTxHash(row.chain, row.txHash);
    if (!txHash) continue;
    const result = insert.run(
      crypto.randomUUID(),
      row.chain,
      row.asset.trim().toUpperCase(),
      row.amount,
      txHash,
      row.transferredAt,
      source,
      options.importBatchId ?? null,
    );
    upserted += result.changes > 0 ? 1 : 0;
  }
  return { upserted };
}

export function updateTransferResolution(
  db: Database.Database,
  id: string,
  update: {
    walletId: string | null;
    onchainAmount: number | null;
    onchainStatus: OnchainStatus;
    notes?: string | null;
  },
): void {
  db.prepare(
    `UPDATE wallet_transfers
     SET wallet_id = ?, onchain_amount = ?, onchain_status = ?, notes = ?
     WHERE id = ?`,
  ).run(
    update.walletId,
    update.onchainAmount,
    update.onchainStatus,
    update.notes ?? null,
    id,
  );
}

export function countTransfersByWallet(
  db: Database.Database,
): Map<string, { total: number; mismatches: number }> {
  const rows = db
    .prepare(
      `SELECT wallet_id AS walletId,
              COUNT(*) AS total,
              SUM(CASE WHEN onchain_status = 'mismatch' THEN 1 ELSE 0 END) AS mismatches
       FROM wallet_transfers
       WHERE wallet_id IS NOT NULL
       GROUP BY wallet_id`,
    )
    .all() as Array<{ walletId: string; total: number; mismatches: number }>;
  return new Map(
    rows.map((row) => [
      row.walletId,
      { total: row.total, mismatches: row.mismatches },
    ]),
  );
}

export function clearWalletData(db: Database.Database): {
  walletsDeleted: number;
  transfersDeleted: number;
} {
  const transfersDeleted = db.prepare("DELETE FROM wallet_transfers").run()
    .changes;
  db.prepare("DELETE FROM wallet_addresses").run();
  const walletsDeleted = db.prepare("DELETE FROM wallets").run().changes;
  return { walletsDeleted, transfersDeleted };
}
