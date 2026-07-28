import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "@/lib/db/migrate";
import { previewIbkrImport } from "@/lib/ibkr/commit";
import { listImportBatches } from "@/lib/import/batches";
import { commitImportWithBatch } from "@/lib/import/commit-with-batch";

const fixtureCsv = readFileSync(
  path.join(__dirname, "fixtures", "ibkr-trades-sample.csv"),
  "utf8",
);

describe("commitImportWithBatch", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("requires a non-empty name and records a batch with linked lots", () => {
    const preview = previewIbkrImport(db, fixtureCsv);

    expect(() =>
      commitImportWithBatch(db, preview.toInsert, {
        name: "  ",
        broker: "ibkr",
      }),
    ).toThrow("Import name is required");

    const result = commitImportWithBatch(db, preview.toInsert, {
      name: "IBKR Flex July",
      broker: "ibkr",
      sourceDetail: "trades",
      fileNames: ["flex.csv"],
      duplicates: 0,
      closedCount: 1,
      skippedCount: 2,
      notes: ["Closed position for MSFT"],
    });

    expect(result.inserted).toBe(2);
    expect(result.batchId).toMatch(/^[0-9a-f-]{36}$/);

    const batches = listImportBatches(db);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      id: result.batchId,
      name: "IBKR Flex July",
      broker: "ibkr",
      sourceDetail: "trades",
      fileNames: ["flex.csv"],
      lotsInserted: 2,
      closedCount: 1,
      skippedCount: 2,
      symbolsTouched: ["AAPL", "MSFT"],
      notes: ["Closed position for MSFT"],
    });

    const linked = db
      .prepare("SELECT COUNT(*) AS n FROM lots WHERE import_batch_id = ?")
      .get(result.batchId) as { n: number };
    expect(linked.n).toBe(2);
  });
});
