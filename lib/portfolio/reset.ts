import type Database from "better-sqlite3";

export type ResetPortfolioResult = {
  holdingsDeleted: number;
  lotsDeleted: number;
  snapshotsDeleted: number;
  importBatchesDeleted: number;
};

/**
 * Wipes holdings, lots, net-worth snapshots, and import history.
 * Keeps settings (base currency), price_cache, and fx_rates.
 */
export function resetPortfolioData(
  db: Database.Database,
): ResetPortfolioResult {
  return db.transaction(() => {
    const lotsDeleted = db.prepare("DELETE FROM lots").run().changes;
    // Clear batch FKs already gone with lots; delete history rows.
    const importBatchesDeleted = db
      .prepare("DELETE FROM import_batches")
      .run().changes;
    const holdingsDeleted = db.prepare("DELETE FROM holdings").run().changes;
    const snapshotsDeleted = db.prepare("DELETE FROM snapshots").run().changes;
    return {
      holdingsDeleted,
      lotsDeleted,
      snapshotsDeleted,
      importBatchesDeleted,
    };
  })();
}
