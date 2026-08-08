import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "@/lib/db/migrate";
import { addLot, createHolding } from "@/lib/holdings-repo";
import {
  createImportBatch,
  deleteImportBatchRecord,
  listImportBatches,
  renameImportBatch,
  suggestImportBatchName,
  updateImportBatchSummary,
} from "@/lib/import/batches";

describe("import batches", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("suggests a broker + date name", () => {
    const day = new Date(2026, 6, 28);
    expect(suggestImportBatchName("cryptocom", day)).toBe(
      "Crypto.com 2026-07-28",
    );
    expect(suggestImportBatchName("binance", day, "auto-invest")).toBe(
      "Binance Auto-Invest 2026-07-28",
    );
    expect(suggestImportBatchName("binance", day, "convert")).toBe(
      "Binance Convert 2026-07-28",
    );
    expect(suggestImportBatchName("ibkr", day)).toBe(
      "Interactive Brokers 2026-07-28",
    );
  });

  it("creates, lists, renames, and updates a batch summary", () => {
    const batch = createImportBatch(db, {
      name: "Crypto.com 2026-07-28",
      broker: "cryptocom",
      sourceDetail: "app",
      fileNames: ["cdc.csv"],
    });

    expect(batch.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(batch.createdAt).toBeTruthy();

    updateImportBatchSummary(db, batch.id, {
      lotsInserted: 3,
      duplicates: 1,
      closedCount: 2,
      skippedCount: 4,
      symbolsTouched: ["BTC", "ETH"],
      notes: ["Applied sell for BTC"],
    });

    const listed = listImportBatches(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: batch.id,
      name: "Crypto.com 2026-07-28",
      broker: "cryptocom",
      sourceDetail: "app",
      fileNames: ["cdc.csv"],
      lotsInserted: 3,
      duplicates: 1,
      closedCount: 2,
      skippedCount: 4,
      symbolsTouched: ["BTC", "ETH"],
      notes: ["Applied sell for BTC"],
    });

    renameImportBatch(db, batch.id, "CDC July dump");
    expect(listImportBatches(db)[0]?.name).toBe("CDC July dump");
  });

  it("deletes history row without removing lots", () => {
    const holding = createHolding(db, {
      type: "crypto",
      name: "BTC",
      symbol: "BTC",
      quoteCurrency: "USD",
    });
    const batch = createImportBatch(db, {
      name: "Binance spot",
      broker: "binance",
      sourceDetail: "spot",
    });
    addLot(db, holding.id, {
      quantity: 1,
      costPerUnit: 100,
      costCurrency: "USD",
      purchasedAt: "2026-01-01",
      importBatchId: batch.id,
    });

    deleteImportBatchRecord(db, batch.id);

    expect(listImportBatches(db)).toEqual([]);
    const lot = db
      .prepare("SELECT import_batch_id, quantity FROM lots")
      .get() as { import_batch_id: string | null; quantity: number };
    expect(lot.quantity).toBe(1);
    expect(lot.import_batch_id).toBeNull();
  });
});
