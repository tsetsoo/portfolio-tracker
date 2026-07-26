import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  commitCryptoComImport,
  previewCryptoComImport,
} from "@/lib/cryptocom/commit";
import { migrate } from "@/lib/db/migrate";

const appCsv = readFileSync(
  path.join(__dirname, "fixtures", "cryptocom-app-sample.csv"),
  "utf8",
);

describe("Crypto.com import commit", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts crypto lots from App CSV and skips duplicates", () => {
    const preview = previewCryptoComImport(db, appCsv);
    expect(preview.toInsert).toHaveLength(2);
    expect(commitCryptoComImport(db, preview.toInsert)).toEqual({
      inserted: 2,
    });

    const holdings = db
      .prepare(
        "SELECT type, symbol FROM holdings ORDER BY symbol",
      )
      .all();
    expect(holdings).toEqual([
      { type: "crypto", symbol: "BTC" },
      { type: "crypto", symbol: "ETH" },
    ]);

    const repeated = previewCryptoComImport(db, appCsv);
    expect(repeated.toInsert).toEqual([]);
    expect(repeated.duplicates).toHaveLength(2);
  });

  it("rolls back on lot insert failure", () => {
    const preview = previewCryptoComImport(db, appCsv);
    const secondId = preview.toInsert[1]?.externalTradeId;
    expect(secondId).toBeTruthy();

    db.exec(`
      CREATE TRIGGER reject_cryptocom_lot
      BEFORE INSERT ON lots
      WHEN NEW.external_trade_id = '${secondId}'
      BEGIN
        SELECT RAISE(ABORT, 'rejected cryptocom lot');
      END;
    `);

    expect(() => commitCryptoComImport(db, preview.toInsert)).toThrow(
      "rejected cryptocom lot",
    );
    expect(
      db.prepare("SELECT count(*) AS count FROM holdings").get(),
    ).toEqual({ count: 0 });
  });
});
