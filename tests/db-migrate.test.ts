import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/migrate";

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles) fs.rmSync(f, { force: true });
});

describe("migrate", () => {
  it("creates tables and default EUR base currency", () => {
    const file = path.join(os.tmpdir(), `pt-${Date.now()}.db`);
    tmpFiles.push(file);
    const db = new Database(file);
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "settings",
        "holdings",
        "lots",
        "price_cache",
        "price_alerts",
        "fx_rates",
        "fx_rates_daily",
        "snapshots",
        "import_batches",
        "wallets",
        "wallet_transfers",
        "wallet_addresses",
      ]),
    );
    const settings = db.prepare("SELECT base_currency FROM settings WHERE id = 1").get() as {
      base_currency: string;
    };
    expect(settings.base_currency).toBe("EUR");
    db.close();
  });

  it("adds nullable import_batch_id on lots for fresh and existing databases", () => {
    const file = path.join(os.tmpdir(), `pt-lots-${Date.now()}.db`);
    tmpFiles.push(file);
    const db = new Database(file);

    // Simulate a pre-existing DB created before import_batches existed.
    db.exec(`
      CREATE TABLE lots (
        id TEXT PRIMARY KEY,
        holding_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        cost_per_unit REAL NOT NULL,
        cost_currency TEXT NOT NULL,
        purchased_at TEXT NOT NULL,
        fees REAL NOT NULL DEFAULT 0,
        external_trade_id TEXT UNIQUE
      );
    `);

    migrate(db);

    const lotCols = db.prepare("PRAGMA table_info(lots)").all() as {
      name: string;
    }[];
    expect(lotCols.map((c) => c.name)).toContain("import_batch_id");

    const batchCols = db.prepare("PRAGMA table_info(import_batches)").all() as {
      name: string;
    }[];
    expect(batchCols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "broker",
        "source_detail",
        "created_at",
        "file_names_json",
        "lots_inserted",
        "duplicates",
        "closed_count",
        "skipped_count",
        "symbols_touched_json",
        "notes_json",
      ]),
    );

    // Idempotent on re-run.
    migrate(db);
    db.close();
  });

  it("widens wallet chain checks to allow BCH on older databases", () => {
    const file = path.join(os.tmpdir(), `pt-bch-${Date.now()}.db`);
    tmpFiles.push(file);
    const db = new Database(file);
    db.exec(`
      CREATE TABLE wallets (
        id TEXT PRIMARY KEY,
        chain TEXT NOT NULL CHECK (chain IN ('eth','btc')),
        address TEXT NOT NULL,
        label TEXT,
        balance REAL,
        balance_asset TEXT,
        created_at TEXT NOT NULL,
        last_synced_at TEXT,
        UNIQUE (chain, address)
      );
      CREATE TABLE wallet_transfers (
        id TEXT PRIMARY KEY,
        wallet_id TEXT REFERENCES wallets(id) ON DELETE SET NULL,
        chain TEXT NOT NULL CHECK (chain IN ('eth','btc')),
        asset TEXT NOT NULL,
        amount REAL NOT NULL,
        tx_hash TEXT NOT NULL UNIQUE,
        transferred_at TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('cryptocom','manual')),
        import_batch_id TEXT,
        onchain_amount REAL,
        onchain_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (onchain_status IN ('pending','matched','mismatch','unresolved','weak')),
        notes TEXT
      );
      CREATE TABLE wallet_addresses (
        id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        balance REAL,
        UNIQUE (wallet_id, address)
      );
      INSERT INTO wallets (id, chain, address, created_at)
      VALUES ('w1', 'eth', '0xabc', '2026-01-01');
    `);

    migrate(db);

    expect(() => {
      db.prepare(
        `INSERT INTO wallets (id, chain, address, created_at)
         VALUES ('w2', 'bch', 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a', '2026-01-02')`,
      ).run();
    }).not.toThrow();

    const eth = db
      .prepare(`SELECT chain FROM wallets WHERE id = 'w1'`)
      .get() as { chain: string };
    expect(eth.chain).toBe("eth");
    db.close();
  });

  it("rebuilds price_cache to key on currency on an old-shape database", () => {
    const file = path.join(os.tmpdir(), `pt-price-cache-${Date.now()}.db`);
    tmpFiles.push(file);
    const db = new Database(file);

    // Simulate a pre-existing DB with the old (symbol, asset_class) key —
    // a stale row that would otherwise collide with a same-symbol row in a
    // different currency once the key changes.
    db.exec(`
      CREATE TABLE price_cache (
        symbol TEXT NOT NULL,
        asset_class TEXT NOT NULL,
        price REAL NOT NULL,
        currency TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (symbol, asset_class)
      );
      INSERT INTO price_cache (symbol, asset_class, price, currency, fetched_at)
      VALUES ('AAPL', 'equity', 211.5, 'USD', '2026-01-01T00:00:00.000Z');
    `);

    migrate(db);

    const cols = db.prepare("PRAGMA table_info(price_cache)").all() as {
      name: string;
      pk: number;
    }[];
    const currencyCol = cols.find((c) => c.name === "currency");
    expect(currencyCol?.pk).toBeGreaterThan(0);

    // price_cache is a pure cache: the rebuild is allowed to drop the old
    // row rather than preserve it.
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM price_cache").get(),
    ).toEqual({ n: 0 });

    // Now that the key includes currency, two currencies for the same
    // symbol coexist instead of colliding.
    db.prepare(
      `INSERT INTO price_cache (symbol, asset_class, price, currency, fetched_at)
       VALUES ('AAPL', 'equity', 211.5, 'USD', '2026-01-01T00:00:00.000Z'),
              ('AAPL', 'equity', 195.2, 'EUR', '2026-01-01T00:00:00.000Z')`,
    ).run();
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM price_cache").get(),
    ).toEqual({ n: 2 });

    db.close();
  });

  it("is a no-op on a database that already keys price_cache on currency", () => {
    const file = path.join(os.tmpdir(), `pt-price-cache-noop-${Date.now()}.db`);
    tmpFiles.push(file);
    const db = new Database(file);

    migrate(db);
    db.prepare(
      `INSERT INTO price_cache (symbol, asset_class, price, currency, fetched_at)
       VALUES ('AAPL', 'equity', 211.5, 'USD', '2026-01-01T00:00:00.000Z')`,
    ).run();

    // Re-running migrate() (as happens on every getDb() call) must not wipe
    // an already-current price_cache.
    migrate(db);
    migrate(db);

    expect(
      db.prepare("SELECT price, currency FROM price_cache").get(),
    ).toEqual({ price: 211.5, currency: "USD" });

    db.close();
  });
});
