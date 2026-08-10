import crypto from "node:crypto";
import type Database from "better-sqlite3";

import { normalizeBchAddress } from "@/lib/wallets/bch";
import type {
  ExchangeWithdrawalRow,
  OnchainStatus,
  OrphanInflow,
  TransferCostStatus,
  Wallet,
  WalletChain,
  WalletTokenBalance,
  WalletTransfer,
  WalletTransferSource,
} from "@/lib/wallets/types";
import {
  deriveBtcAddressWindow,
  parseBtcXpub,
  type BtcScriptType,
} from "@/lib/wallets/xpub";

type WalletRow = {
  id: string;
  chain: WalletChain;
  address: string;
  label: string | null;
  balance: number | null;
  balance_asset: string | null;
  created_at: string;
  last_synced_at: string | null;
  xpub: string | null;
  script_type: BtcScriptType | null;
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
  cost_basis: number | null;
  cost_currency: string | null;
  cost_status: TransferCostStatus;
  cost_notes: string | null;
};

function mapWallet(row: WalletRow, addresses: string[]): Wallet {
  const list = addresses.length > 0 ? addresses : [row.address];
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    addresses: list,
    xpub: row.xpub,
    scriptType: row.script_type,
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
    costBasis: row.cost_basis,
    costCurrency: row.cost_currency,
    costStatus: row.cost_status ?? "unknown",
    costNotes: row.cost_notes,
  };
}

function transferSelectSql(): string {
  return `SELECT id, wallet_id, chain, asset, amount, tx_hash, transferred_at,
                source, import_batch_id, onchain_amount, onchain_status, notes,
                cost_basis, cost_currency, cost_status, cost_notes
         FROM wallet_transfers`;
}

function normalizeAddress(chain: WalletChain, address: string): string {
  const trimmed = address.trim();
  if (chain === "eth") return trimmed.toLowerCase();
  if (chain === "bch") return normalizeBchAddress(trimmed);
  return trimmed;
}

function normalizeTxHash(chain: WalletChain, txHash: string): string {
  const trimmed = txHash.trim();
  if (chain === "eth") {
    const lower = trimmed.toLowerCase();
    return lower.startsWith("0x") ? lower : `0x${lower}`;
  }
  return trimmed.toLowerCase();
}

export function listAddressesForWallet(
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
  meta?: { path?: string | null; isChange?: boolean },
): void {
  db.prepare(
    `INSERT INTO wallet_addresses (id, wallet_id, address, balance, derivation_path, is_change)
     VALUES (?, ?, ?, NULL, ?, ?)
     ON CONFLICT(wallet_id, address) DO UPDATE SET
       derivation_path = COALESCE(excluded.derivation_path, wallet_addresses.derivation_path),
       is_change = excluded.is_change`,
  ).run(
    crypto.randomUUID(),
    walletId,
    address,
    meta?.path ?? null,
    meta?.isChange ? 1 : 0,
  );
}

function findWalletIdByAddress(
  db: Database.Database,
  address: string,
): string | null {
  const row = db
    .prepare(
      `SELECT wallet_id AS walletId FROM wallet_addresses WHERE address = ?`,
    )
    .get(address) as { walletId: string } | undefined;
  return row?.walletId ?? null;
}

function getWalletRow(
  db: Database.Database,
  id: string,
): WalletRow | undefined {
  return db
    .prepare(
      `SELECT id, chain, address, label, balance, balance_asset, created_at, last_synced_at,
              xpub, script_type
       FROM wallets WHERE id = ?`,
    )
    .get(id) as WalletRow | undefined;
}

export function listWallets(db: Database.Database): Wallet[] {
  const rows = db
    .prepare(
      `SELECT id, chain, address, label, balance, balance_asset, created_at, last_synced_at,
              xpub, script_type
       FROM wallets
       ORDER BY chain, address`,
    )
    .all() as WalletRow[];
  return rows.map((row) => mapWallet(row, listAddressesForWallet(db, row.id)));
}

export function getBtcXpubWallet(db: Database.Database): Wallet | null {
  const row = db
    .prepare(
      `SELECT id, chain, address, label, balance, balance_asset, created_at, last_synced_at,
              xpub, script_type
       FROM wallets
       WHERE chain = 'btc' AND xpub IS NOT NULL
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .get() as WalletRow | undefined;
  if (!row) return null;
  return mapWallet(row, listAddressesForWallet(db, row.id));
}

export function listWalletTransfers(
  db: Database.Database,
  walletId?: string,
): WalletTransfer[] {
  if (walletId) {
    const rows = db
      .prepare(
        `${transferSelectSql()}
         WHERE wallet_id = ?
         ORDER BY transferred_at DESC, id`,
      )
      .all(walletId) as TransferRow[];
    return rows.map(mapTransfer);
  }
  const rows = db
    .prepare(
      `${transferSelectSql()}
       ORDER BY transferred_at DESC, id`,
    )
    .all() as TransferRow[];
  return rows.map(mapTransfer);
}

export function listPendingTransfers(db: Database.Database): WalletTransfer[] {
  const rows = db
    .prepare(
      `${transferSelectSql()}
       WHERE onchain_status IN ('pending','unresolved','weak')
          OR wallet_id IS NULL
       ORDER BY transferred_at ASC`,
    )
    .all() as TransferRow[];
  return rows.map(mapTransfer);
}

export function listKnownTransferTxHashes(db: Database.Database): Set<string> {
  const rows = db
    .prepare(`SELECT tx_hash AS txHash FROM wallet_transfers`)
    .all() as Array<{ txHash: string }>;
  return new Set(rows.map((row) => row.txHash.toLowerCase()));
}

export function getOrCreateWallet(
  db: Database.Database,
  chain: WalletChain,
  address: string,
  label?: string | null,
): Wallet {
  if (chain === "btc") {
    throw new Error("Bitcoin wallets are managed via xpub, not raw addresses");
  }

  const normalized = normalizeAddress(chain, address);
  const byAddress = findWalletIdByAddress(db, normalized);
  if (byAddress) {
    const row = getWalletRow(db, byAddress);
    if (row) return mapWallet(row, listAddressesForWallet(db, row.id));
  }

  const existing = db
    .prepare(
      `SELECT id, chain, address, label, balance, balance_asset, created_at, last_synced_at,
              xpub, script_type
       FROM wallets WHERE chain = ? AND address = ?`,
    )
    .get(chain, normalized) as WalletRow | undefined;
  if (existing) {
    ensureWalletAddress(db, existing.id, normalized);
    return mapWallet(existing, listAddressesForWallet(db, existing.id));
  }

  const walletId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO wallets
       (id, chain, address, label, balance, balance_asset, created_at, last_synced_at, xpub, script_type)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL)`,
  ).run(
    walletId,
    chain,
    normalized,
    label?.trim() || null,
    createdAt,
  );
  ensureWalletAddress(db, walletId, normalized);
  return mapWallet(getWalletRow(db, walletId)!, [normalized]);
}

/**
 * Replace any existing BTC wallets with a single watch-only xpub account.
 * Seeds derivation window (receive + change) using gap limit.
 */
export function setBtcXpubWallet(
  db: Database.Database,
  extendedKey: string,
  label?: string | null,
  scriptType?: BtcScriptType,
): Wallet {
  const parsed = parseBtcXpub(extendedKey, { scriptType });

  return db.transaction(() => {
    const existingBtc = db
      .prepare(`SELECT id FROM wallets WHERE chain = 'btc'`)
      .all() as Array<{ id: string }>;
    // Re-queue all BTC transfers so Scan re-links against the new derivation set.
    db.prepare(
      `UPDATE wallet_transfers
       SET wallet_id = NULL, onchain_status = 'pending',
           onchain_amount = NULL, notes = NULL
       WHERE chain = 'btc'`,
    ).run();
    for (const row of existingBtc) {
      db.prepare(`DELETE FROM wallet_addresses WHERE wallet_id = ?`).run(row.id);
      db.prepare(`DELETE FROM wallets WHERE id = ?`).run(row.id);
    }

    const walletId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO wallets
         (id, chain, address, label, balance, balance_asset, created_at, last_synced_at, xpub, script_type)
       VALUES (?, 'btc', ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
    ).run(
      walletId,
      parsed.firstReceive,
      label?.trim() || null,
      createdAt,
      parsed.xpub,
      parsed.scriptType,
    );

    const derived = deriveBtcAddressWindow(parsed.xpub, {
      gapLimit: 20,
      scriptType: parsed.scriptType,
    });
    for (const item of derived) {
      ensureWalletAddress(db, walletId, item.address, {
        path: item.path,
        isChange: item.isChange,
      });
    }

    return mapWallet(
      getWalletRow(db, walletId)!,
      derived.map((item) => item.address),
    );
  })();
}

/** Expand derivation window when addresses show usage (gap-limit advance). */
export function syncBtcDerivedAddresses(
  db: Database.Database,
  walletId: string,
  usedAddresses: Set<string>,
): string[] {
  const row = getWalletRow(db, walletId);
  if (!row?.xpub || !row.script_type) return listAddressesForWallet(db, walletId);

  const derived = deriveBtcAddressWindow(row.xpub, {
    gapLimit: 20,
    usedAddresses,
    scriptType: row.script_type,
  });
  for (const item of derived) {
    ensureWalletAddress(db, walletId, item.address, {
      path: item.path,
      isChange: item.isChange,
    });
  }
  return listAddressesForWallet(db, walletId);
}

export function createManualWallet(
  db: Database.Database,
  chain: WalletChain,
  address: string,
  label?: string | null,
): Wallet {
  if (chain === "bch") {
    return addBchAddress(db, address, label);
  }
  return getOrCreateWallet(db, chain, address, label);
}

/**
 * Keep a single BCH wallet and attach further CashAddr/legacy addresses to it
 * (same idea as BTC's multi-address bag, without requiring an xpub).
 */
export function addBchAddress(
  db: Database.Database,
  address: string,
  label?: string | null,
): Wallet {
  const normalized = normalizeAddress("bch", address);
  const already = findWalletIdByAddress(db, normalized);
  if (already) {
    const row = getWalletRow(db, already);
    if (row) {
      if (label?.trim() && !row.label) {
        updateWalletLabel(db, already, label);
      }
      return mapWallet(
        getWalletRow(db, already)!,
        listAddressesForWallet(db, already),
      );
    }
  }

  const bag = db
    .prepare(
      `SELECT id, chain, address, label, balance, balance_asset, created_at, last_synced_at,
              xpub, script_type
       FROM wallets
       WHERE chain = 'bch'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .get() as WalletRow | undefined;

  if (bag) {
    ensureWalletAddress(db, bag.id, normalized);
    if (label?.trim() && !bag.label) {
      updateWalletLabel(db, bag.id, label);
    }
    return mapWallet(
      getWalletRow(db, bag.id)!,
      listAddressesForWallet(db, bag.id),
    );
  }

  return getOrCreateWallet(db, "bch", normalized, label);
}

/** Merge every BCH wallet into the oldest one; returns the surviving wallet. */
export function consolidateBchWallets(db: Database.Database): Wallet | null {
  const bags = db
    .prepare(
      `SELECT id FROM wallets WHERE chain = 'bch' ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{ id: string }>;
  if (bags.length === 0) return null;
  const primaryId = bags[0]!.id;

  return db.transaction(() => {
    for (const row of bags.slice(1)) {
      // Address is globally unique — re-parent rows instead of inserting copies.
      db.prepare(
        `UPDATE wallet_addresses SET wallet_id = ? WHERE wallet_id = ?`,
      ).run(primaryId, row.id);
      db.prepare(
        `UPDATE wallet_transfers SET wallet_id = ? WHERE wallet_id = ?`,
      ).run(primaryId, row.id);
      db.prepare(`DELETE FROM wallets WHERE id = ?`).run(row.id);
    }
    return mapWallet(
      getWalletRow(db, primaryId)!,
      listAddressesForWallet(db, primaryId),
    );
  })();
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

function inferCostStatus(row: ExchangeWithdrawalRow): TransferCostStatus {
  if (row.costStatus) return row.costStatus;
  if (row.costBasis != null && row.costBasis > 0) return "costed";
  return "unknown";
}

export function upsertWalletTransfersFromWithdrawals(
  db: Database.Database,
  withdrawals: ExchangeWithdrawalRow[],
  options: { importBatchId?: string | null; source?: WalletTransferSource } = {},
): { upserted: number } {
  const source = options.source ?? "cryptocom";
  const insert = db.prepare(
    `INSERT INTO wallet_transfers
       (id, wallet_id, chain, asset, amount, tx_hash, transferred_at, source,
        import_batch_id, onchain_amount, onchain_status, notes,
        cost_basis, cost_currency, cost_status, cost_notes)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', NULL, ?, ?, ?, ?)
     ON CONFLICT(tx_hash) DO UPDATE SET
       amount = excluded.amount,
       asset = excluded.asset,
       transferred_at = excluded.transferred_at,
       source = excluded.source,
       import_batch_id = COALESCE(excluded.import_batch_id, wallet_transfers.import_batch_id),
       cost_basis = COALESCE(excluded.cost_basis, wallet_transfers.cost_basis),
       cost_currency = COALESCE(excluded.cost_currency, wallet_transfers.cost_currency),
       cost_status = CASE
         WHEN excluded.cost_status IN ('costed','partial','gift') THEN excluded.cost_status
         WHEN wallet_transfers.cost_status IN ('costed','partial','gift') THEN wallet_transfers.cost_status
         ELSE excluded.cost_status
       END,
       cost_notes = COALESCE(excluded.cost_notes, wallet_transfers.cost_notes)`,
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
      row.costBasis ?? null,
      row.costCurrency ?? null,
      inferCostStatus(row),
      row.costNotes ?? null,
    );
    upserted += result.changes > 0 ? 1 : 0;
  }
  return { upserted };
}

export function updateTransferCost(
  db: Database.Database,
  id: string,
  update: {
    costBasis: number | null;
    costCurrency: string | null;
    costStatus: TransferCostStatus;
    costNotes?: string | null;
  },
): void {
  db.prepare(
    `UPDATE wallet_transfers
     SET cost_basis = ?, cost_currency = ?, cost_status = ?, cost_notes = ?
     WHERE id = ?`,
  ).run(
    update.costBasis,
    update.costCurrency,
    update.costStatus,
    update.costNotes ?? null,
    id,
  );
}

/** How `setTransferManualCostAction` marks a manually-overridden cost. */
const MANUAL_COST_OVERRIDE_NOTE = "manual cost override";

/** True if `costNotes` looks like a manual override written via the UI action. */
function isManualCostOverrideNote(costNotes: string | null): boolean {
  if (!costNotes) return false;
  return costNotes.toLowerCase().includes(MANUAL_COST_OVERRIDE_NOTE);
}

/**
 * True if applying `proposed` over `existing` would downgrade an already
 * well-costed row to `partial` or to a zero cost basis. Never true if the
 * existing row's basis was already zero/unset — there is nothing to protect.
 */
function isCostDowngrade(
  existing: { cost_status: string; cost_basis: number | null },
  proposed: Pick<ExchangeWithdrawalRow, "costBasis" | "costStatus">,
): boolean {
  const existingIsGoodCosted =
    existing.cost_status === "costed" &&
    existing.cost_basis != null &&
    existing.cost_basis > 0;
  if (!existingIsGoodCosted) return false;
  const proposedIsPartial = proposed.costStatus === "partial";
  const proposedIsZeroBasis = (proposed.costBasis ?? 0) === 0;
  return proposedIsPartial || proposedIsZeroBasis;
}

export function applyWithdrawalCostsSkippingGift(
  db: Database.Database,
  withdrawals: ExchangeWithdrawalRow[],
): {
  updated: number;
  skippedGift: number;
  skippedManual: number;
  skippedDowngrade: number;
  unmatched: number;
} {
  let updated = 0;
  let skippedGift = 0;
  let skippedManual = 0;
  let skippedDowngrade = 0;
  let unmatched = 0;
  const select = db.prepare(
    `SELECT id, cost_status, cost_basis, cost_notes FROM wallet_transfers WHERE tx_hash = ?`,
  );

  db.transaction(() => {
    for (const row of withdrawals) {
      if (row.costBasis == null || row.costStatus == null) continue;
      const txHash = normalizeTxHash(row.chain, row.txHash);
      if (!txHash) continue;
      const existing = select.get(txHash) as
        | {
            id: string;
            cost_status: string;
            cost_basis: number | null;
            cost_notes: string | null;
          }
        | undefined;
      if (!existing) {
        unmatched += 1;
        continue;
      }
      if (existing.cost_status === "gift") {
        skippedGift += 1;
        continue;
      }
      if (isManualCostOverrideNote(existing.cost_notes)) {
        skippedManual += 1;
        continue;
      }
      if (isCostDowngrade(existing, row)) {
        skippedDowngrade += 1;
        continue;
      }
      updateTransferCost(db, existing.id, {
        costBasis: row.costBasis,
        costCurrency: row.costCurrency ?? "EUR",
        costStatus: row.costStatus,
        costNotes: row.costNotes ?? null,
      });
      updated += 1;
    }
  })();

  return { updated, skippedGift, skippedManual, skippedDowngrade, unmatched };
}

/** Persist an unmatched on-chain inflow as a manual gift (zero cost basis). */
export function markOrphanInflowAsGift(
  db: Database.Database,
  orphan: Pick<
    OrphanInflow,
    "chain" | "asset" | "amount" | "txHash" | "transferredAt" | "toAddress"
  >,
): WalletTransfer {
  const txHash = normalizeTxHash(orphan.chain, orphan.txHash);
  if (!txHash) throw new Error("Invalid transaction hash");
  if (!(orphan.amount > 0)) throw new Error("Amount must be positive");

  const wallet = getOrCreateWallet(db, orphan.chain, orphan.toAddress);
  const existing = db
    .prepare(`${transferSelectSql()} WHERE tx_hash = ?`)
    .get(txHash) as TransferRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE wallet_transfers
       SET wallet_id = ?,
           amount = ?,
           asset = ?,
           transferred_at = ?,
           source = 'manual',
           onchain_amount = ?,
           onchain_status = 'matched',
           cost_basis = NULL,
           cost_currency = NULL,
           cost_status = 'gift',
           cost_notes = ?,
           notes = COALESCE(notes, ?)
       WHERE id = ?`,
    ).run(
      wallet.id,
      orphan.amount,
      orphan.asset.trim().toUpperCase(),
      orphan.transferredAt,
      orphan.amount,
      "Marked as gift / unknown source",
      "Gift / unknown source inflow",
      existing.id,
    );
    const updated = db
      .prepare(`${transferSelectSql()} WHERE id = ?`)
      .get(existing.id) as TransferRow;
    return mapTransfer(updated);
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO wallet_transfers
       (id, wallet_id, chain, asset, amount, tx_hash, transferred_at, source,
        import_batch_id, onchain_amount, onchain_status, notes,
        cost_basis, cost_currency, cost_status, cost_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', NULL, ?, 'matched', ?, NULL, NULL, 'gift', ?)`,
  ).run(
    id,
    wallet.id,
    orphan.chain,
    orphan.asset.trim().toUpperCase(),
    orphan.amount,
    txHash,
    orphan.transferredAt,
    orphan.amount,
    "Gift / unknown source inflow",
    "Marked as gift / unknown source",
  );
  const row = db
    .prepare(`${transferSelectSql()} WHERE id = ?`)
    .get(id) as TransferRow;
  return mapTransfer(row);
}

export function listTokenBalancesForWallet(
  db: Database.Database,
  walletId: string,
): WalletTokenBalance[] {
  const rows = db
    .prepare(
      `SELECT wallet_id, asset, balance, value_base, value_currency, updated_at
       FROM wallet_token_balances
       WHERE wallet_id = ?
       ORDER BY asset`,
    )
    .all(walletId) as Array<{
    wallet_id: string;
    asset: string;
    balance: number;
    value_base: number | null;
    value_currency: string | null;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    walletId: row.wallet_id,
    asset: row.asset,
    balance: row.balance,
    valueBase: row.value_base,
    valueCurrency: row.value_currency,
    updatedAt: row.updated_at,
  }));
}

export function replaceWalletTokenBalances(
  db: Database.Database,
  walletId: string,
  tokens: Array<{
    asset: string;
    balance: number;
    valueBase: number | null;
    valueCurrency: string | null;
  }>,
): void {
  const updatedAt = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`DELETE FROM wallet_token_balances WHERE wallet_id = ?`).run(
      walletId,
    );
    const insert = db.prepare(
      `INSERT INTO wallet_token_balances
         (wallet_id, asset, balance, value_base, value_currency, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const token of tokens) {
      insert.run(
        walletId,
        token.asset.trim().toUpperCase(),
        token.balance,
        token.valueBase,
        token.valueCurrency,
        updatedAt,
      );
    }
  })();
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
  try {
    db.prepare("DELETE FROM wallet_token_balances").run();
  } catch {
    // Table may not exist on very old DBs mid-migrate.
  }
  const transfersDeleted = db.prepare("DELETE FROM wallet_transfers").run()
    .changes;
  db.prepare("DELETE FROM wallet_addresses").run();
  const walletsDeleted = db.prepare("DELETE FROM wallets").run().changes;
  return { walletsDeleted, transfersDeleted };
}
