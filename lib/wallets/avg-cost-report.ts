import type Database from "better-sqlite3";

export type AssetAvgCostRow = {
  asset: string;
  qtyOnChain: number;
  qtyCosted: number;
  qtyPartial: number;
  qtyGift: number;
  qtyUnknown: number;
  costEurCosted: number;
  avgEurTaxReady: number | null;
  costEurPartial: number;
  partialMissingNotes: string[];
};

export type WalletAvgCostReport = AssetAvgCostRow[];

const SUPPORTED_ASSETS = new Set(["BTC", "ETH", "LINK"]);
const DEFAULT_ASSETS = ["BTC", "ETH", "LINK"];

type TransferTotals = {
  qtyCosted: number;
  qtyPartial: number;
  qtyGift: number;
  costEurCosted: number;
  costEurPartial: number;
};

function requestedAssets(assets?: string[]): string[] {
  const requested = assets ?? DEFAULT_ASSETS;
  const normalized = requested
    .map((asset) => asset.trim().toUpperCase())
    .filter((asset) => SUPPORTED_ASSETS.has(asset));
  return [...new Set(normalized)];
}

function nativeBalance(db: Database.Database, asset: "BTC" | "ETH"): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(balance), 0) AS total
       FROM wallets
       WHERE UPPER(TRIM(balance_asset)) = ?
          OR (
            (balance_asset IS NULL OR TRIM(balance_asset) = '')
            AND LOWER(chain) = LOWER(?)
          )`,
    )
    .get(asset, asset) as { total: number };
  return row.total;
}

function tokenBalance(db: Database.Database, asset: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(balance), 0) AS total
       FROM wallet_token_balances
       WHERE UPPER(TRIM(asset)) = ?`,
    )
    .get(asset) as { total: number };
  return row.total;
}

function transferTotals(
  db: Database.Database,
  asset: string,
): TransferTotals {
  return db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN cost_status = 'costed' THEN amount ELSE 0 END), 0)
           AS qtyCosted,
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
         ), 0) AS costEurCosted,
         COALESCE(SUM(
           CASE
             WHEN cost_status = 'partial'
              AND UPPER(TRIM(cost_currency)) = 'EUR'
             THEN cost_basis
             ELSE 0
           END
         ), 0) AS costEurPartial
       FROM wallet_transfers
       WHERE UPPER(TRIM(asset)) = ?`,
    )
    .get(asset) as TransferTotals;
}

function partialMissingNotes(
  db: Database.Database,
  asset: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT TRIM(cost_notes) AS note
       FROM wallet_transfers
       WHERE UPPER(TRIM(asset)) = ?
         AND cost_status = 'partial'
         AND cost_notes IS NOT NULL
         AND TRIM(cost_notes) != ''
       ORDER BY note`,
    )
    .all(asset) as Array<{ note: string }>;
  return rows.map((row) => row.note);
}

export function buildWalletAvgCostReport(
  db: Database.Database,
  assets?: string[],
): WalletAvgCostReport {
  return requestedAssets(assets).map((asset) => {
    const qtyOnChain =
      asset === "LINK"
        ? tokenBalance(db, asset)
        : nativeBalance(db, asset as "BTC" | "ETH");
    const totals = transferTotals(db, asset);

    return {
      asset,
      qtyOnChain,
      qtyCosted: totals.qtyCosted,
      qtyPartial: totals.qtyPartial,
      qtyGift: totals.qtyGift,
      qtyUnknown: Math.max(
        0,
        qtyOnChain - totals.qtyCosted - totals.qtyPartial - totals.qtyGift,
      ),
      costEurCosted: totals.costEurCosted,
      avgEurTaxReady:
        totals.qtyCosted > 0
          ? totals.costEurCosted / totals.qtyCosted
          : null,
      costEurPartial: totals.costEurPartial,
      partialMissingNotes: partialMissingNotes(db, asset),
    };
  });
}
