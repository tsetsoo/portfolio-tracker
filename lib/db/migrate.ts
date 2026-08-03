import type Database from "better-sqlite3";

function hasColumn(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_currency TEXT NOT NULL DEFAULT 'EUR'
    );
    INSERT OR IGNORE INTO settings (id, base_currency) VALUES (1, 'EUR');

    CREATE TABLE IF NOT EXISTS holdings (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('equity','crypto','manual')),
      symbol TEXT,
      name TEXT NOT NULL,
      quote_currency TEXT,
      manual_value REAL,
      notes TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lots (
      id TEXT PRIMARY KEY,
      holding_id TEXT NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
      quantity REAL NOT NULL,
      cost_per_unit REAL NOT NULL,
      cost_currency TEXT NOT NULL,
      purchased_at TEXT NOT NULL,
      fees REAL NOT NULL DEFAULT 0,
      external_trade_id TEXT UNIQUE,
      import_batch_id TEXT
    );

    CREATE TABLE IF NOT EXISTS price_cache (
      symbol TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (symbol, asset_class)
    );

    CREATE TABLE IF NOT EXISTS fx_rates (
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (from_currency, to_currency)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      date TEXT PRIMARY KEY,
      total_base REAL NOT NULL,
      breakdown_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      broker TEXT NOT NULL CHECK (broker IN ('ibkr','binance','cryptocom')),
      source_detail TEXT,
      created_at TEXT NOT NULL,
      file_names_json TEXT NOT NULL DEFAULT '[]',
      lots_inserted INTEGER NOT NULL DEFAULT 0,
      duplicates INTEGER NOT NULL DEFAULT 0,
      closed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      symbols_touched_json TEXT NOT NULL DEFAULT '[]',
      notes_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS wallets (
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

    CREATE TABLE IF NOT EXISTS wallet_transfers (
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

    CREATE TABLE IF NOT EXISTS wallet_addresses (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      address TEXT NOT NULL,
      balance REAL,
      UNIQUE (wallet_id, address)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS wallet_addresses_address_uidx
      ON wallet_addresses(address);
  `);

  // Existing DBs created before import_batch_id: add the column safely.
  if (hasColumn(db, "lots", "id") && !hasColumn(db, "lots", "import_batch_id")) {
    db.exec(`ALTER TABLE lots ADD COLUMN import_batch_id TEXT`);
  }

  // Backfill receive addresses for wallets created before wallet_addresses.
  if (hasColumn(db, "wallets", "id") && hasColumn(db, "wallet_addresses", "id")) {
    db.exec(`
      INSERT OR IGNORE INTO wallet_addresses (id, wallet_id, address, balance)
      SELECT lower(hex(randomblob(16))), id, address, balance
      FROM wallets
      WHERE address IS NOT NULL AND trim(address) != ''
    `);
  }

  if (hasColumn(db, "wallets", "id") && !hasColumn(db, "wallets", "xpub")) {
    db.exec(`ALTER TABLE wallets ADD COLUMN xpub TEXT`);
  }
  if (hasColumn(db, "wallets", "id") && !hasColumn(db, "wallets", "script_type")) {
    db.exec(`ALTER TABLE wallets ADD COLUMN script_type TEXT`);
  }
  if (
    hasColumn(db, "wallet_addresses", "id") &&
    !hasColumn(db, "wallet_addresses", "derivation_path")
  ) {
    db.exec(`ALTER TABLE wallet_addresses ADD COLUMN derivation_path TEXT`);
  }
  if (
    hasColumn(db, "wallet_addresses", "id") &&
    !hasColumn(db, "wallet_addresses", "is_change")
  ) {
    db.exec(
      `ALTER TABLE wallet_addresses ADD COLUMN is_change INTEGER NOT NULL DEFAULT 0`,
    );
  }
}
