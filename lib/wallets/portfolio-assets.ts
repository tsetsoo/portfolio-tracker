import type Database from "better-sqlite3";

export type WalletAssetQuantity = {
  asset: string;
  quantity: number;
};

export type WalletAssetCost = {
  asset: string;
  /** True when on-chain qty is fully covered by costed + gift transfers (no partial/unknown). */
  complete: boolean;
  costBasisEur: number | null;
  avgCostPerUnitEur: number | null;
};

function chainDefaultAsset(chain: string): string | null {
  switch (chain.toLowerCase()) {
    case "btc":
      return "BTC";
    case "eth":
      return "ETH";
    case "bch":
      return "BCH";
    default:
      return null;
  }
}

/** Sum on-chain native + ERC-20 balances by asset ticker. */
export function listWalletAssetQuantities(
  db: Database.Database,
): WalletAssetQuantity[] {
  const byAsset = new Map<string, number>();

  const wallets = db
    .prepare(
      `SELECT chain, balance, balance_asset
       FROM wallets
       WHERE balance IS NOT NULL AND balance > 0`,
    )
    .all() as Array<{
    chain: string;
    balance: number;
    balance_asset: string | null;
  }>;

  for (const wallet of wallets) {
    const labelled = wallet.balance_asset?.trim().toUpperCase() ?? "";
    const asset = labelled || chainDefaultAsset(wallet.chain);
    if (!asset) continue;
    byAsset.set(asset, (byAsset.get(asset) ?? 0) + wallet.balance);
  }

  const tokens = db
    .prepare(
      `SELECT UPPER(TRIM(asset)) AS asset, SUM(balance) AS total
       FROM wallet_token_balances
       WHERE balance > 0
       GROUP BY UPPER(TRIM(asset))`,
    )
    .all() as Array<{ asset: string; total: number }>;

  for (const row of tokens) {
    if (!row.asset) continue;
    byAsset.set(row.asset, (byAsset.get(row.asset) ?? 0) + row.total);
  }

  return [...byAsset.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([asset, quantity]) => ({ asset, quantity }))
    .sort((a, b) => a.asset.localeCompare(b.asset));
}

type TransferTotals = {
  qtyCosted: number;
  qtyCostedEur: number;
  qtyPartial: number;
  qtyGift: number;
  costEurCosted: number;
};

function transferTotals(
  db: Database.Database,
  asset: string,
): TransferTotals {
  return db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN cost_status = 'costed' THEN amount ELSE 0 END), 0)
           AS qtyCosted,
         COALESCE(SUM(
           CASE
             WHEN cost_status = 'costed'
              AND UPPER(TRIM(cost_currency)) = 'EUR'
             THEN amount
             ELSE 0
           END
         ), 0) AS qtyCostedEur,
         COALESCE(SUM(CASE WHEN cost_status = 'partial' THEN amount ELSE 0 END), 0)
           AS qtyPartial,
         COALESCE(SUM(CASE WHEN cost_status = 'gift' THEN amount ELSE 0 END), 0)
           AS qtyGift,
         COALESCE(SUM(
           CASE
             WHEN cost_status = 'costed'
              AND UPPER(TRIM(cost_currency)) = 'EUR'
             THEN cost_basis
             ELSE 0
           END
         ), 0) AS costEurCosted
       FROM wallet_transfers
       WHERE UPPER(TRIM(asset)) = ?`,
    )
    .get(asset) as TransferTotals;
}

/**
 * Cost basis for wallet assets. Complete only when every on-chain unit is
 * covered by costed (EUR) or gift transfers — no partial/unknown remainder.
 */
export function walletAssetCost(
  db: Database.Database,
  asset: string,
  quantity: number,
): WalletAssetCost {
  const totals = transferTotals(db, asset);
  const covered = totals.qtyCosted + totals.qtyPartial + totals.qtyGift;
  const qtyUnknown = Math.max(0, quantity - covered);
  const complete =
    quantity > 0 &&
    totals.qtyPartial === 0 &&
    qtyUnknown === 0 &&
    totals.qtyCostedEur + totals.qtyGift >= quantity - 1e-12;

  const avgCostPerUnitEur =
    totals.qtyCostedEur > 0
      ? totals.costEurCosted / totals.qtyCostedEur
      : null;

  if (!complete) {
    return {
      asset,
      complete: false,
      costBasisEur: null,
      avgCostPerUnitEur,
    };
  }

  // Gifts contribute quantity at zero cost; costed EUR lots contribute basis.
  return {
    asset,
    complete: true,
    costBasisEur: totals.costEurCosted,
    avgCostPerUnitEur:
      quantity > 0 ? totals.costEurCosted / quantity : avgCostPerUnitEur,
  };
}
