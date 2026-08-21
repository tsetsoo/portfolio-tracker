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

    CREATE TABLE IF NOT EXISTS fx_rates_daily (
      rate_date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (rate_date, from_currency, to_currency)
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
      chain TEXT NOT NULL CHECK (chain IN ('eth','btc','bch')),
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
      chain TEXT NOT NULL CHECK (chain IN ('eth','btc','bch')),
      asset TEXT NOT NULL,
      amount REAL NOT NULL,
      tx_hash TEXT NOT NULL UNIQUE,
      transferred_at TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('cryptocom','binance','manual')),
      import_batch_id TEXT,
      onchain_amount REAL,
      onchain_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (onchain_status IN ('pending','matched','mismatch','unresolved','weak')),
      notes TEXT,
      cost_basis REAL,
      cost_currency TEXT,
      cost_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (cost_status IN ('costed','partial','unknown','gift')),
      cost_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS wallet_token_balances (
      wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      asset TEXT NOT NULL,
      balance REAL NOT NULL,
      value_base REAL,
      value_currency TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (wallet_id, asset)
    );

    CREATE TABLE IF NOT EXISTS wallet_addresses (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      address TEXT NOT NULL,
      balance REAL,
      UNIQUE (wallet_id, address)
    );

    CREATE TABLE IF NOT EXISTS price_alerts (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      asset_class TEXT NOT NULL CHECK (asset_class IN ('equity','crypto')),
      kind TEXT NOT NULL CHECK (kind IN ('threshold','percent_move')),
      direction TEXT NOT NULL,
      target_price REAL,
      percent REAL,
      anchor_price REAL,
      anchor_at TEXT,
      currency TEXT NOT NULL,
      label TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      cooldown_minutes INTEGER NOT NULL DEFAULT 1440,
      last_fired_at TEXT,
      last_checked_at TEXT,
      last_price REAL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      CHECK (
        (kind = 'threshold'
          AND direction IN ('above','below')
          AND target_price IS NOT NULL
          AND percent IS NULL)
        OR (kind = 'percent_move'
          AND direction IN ('up','down','either')
          AND percent IS NOT NULL AND percent > 0
          AND anchor_price IS NOT NULL
          AND target_price IS NULL)
      )
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

  widenWalletChainChecks(db);

  if (
    hasColumn(db, "wallet_transfers", "id") &&
    !hasColumn(db, "wallet_transfers", "cost_basis")
  ) {
    db.exec(`ALTER TABLE wallet_transfers ADD COLUMN cost_basis REAL`);
  }
  if (
    hasColumn(db, "wallet_transfers", "id") &&
    !hasColumn(db, "wallet_transfers", "cost_currency")
  ) {
    db.exec(`ALTER TABLE wallet_transfers ADD COLUMN cost_currency TEXT`);
  }
  if (
    hasColumn(db, "wallet_transfers", "id") &&
    !hasColumn(db, "wallet_transfers", "cost_status")
  ) {
    db.exec(
      `ALTER TABLE wallet_transfers ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'unknown'`,
    );
    db.exec(`
      UPDATE wallet_transfers
      SET cost_status = 'costed'
      WHERE cost_basis IS NOT NULL AND cost_basis > 0
    `);
  }
  if (
    hasColumn(db, "wallet_transfers", "id") &&
    !hasColumn(db, "wallet_transfers", "cost_notes")
  ) {
    db.exec(`ALTER TABLE wallet_transfers ADD COLUMN cost_notes TEXT`);
  }

  widenWalletTransferSource(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_token_balances (
      wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      asset TEXT NOT NULL,
      balance REAL NOT NULL,
      value_base REAL,
      value_currency TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (wallet_id, asset)
    );
  `);
}

/** SQLite CHECK constraints are baked into CREATE TABLE; rebuild when BCH missing. */
function chainAllowsBch(db: Database.Database): boolean {
  try {
    db.prepare(
      `INSERT INTO wallets (id, chain, address, created_at)
       VALUES ('__bch_probe__', 'bch', 'probe', '1970-01-01')`,
    ).run();
    db.prepare(`DELETE FROM wallets WHERE id = '__bch_probe__'`).run();
    return true;
  } catch {
    return false;
  }
}

function widenWalletChainChecks(db: Database.Database): void {
  if (!hasColumn(db, "wallets", "id") || chainAllowsBch(db)) return;

  db.exec(`PRAGMA foreign_keys = OFF`);
  try {
    db.exec(`
      CREATE TABLE wallets_new (
        id TEXT PRIMARY KEY,
        chain TEXT NOT NULL CHECK (chain IN ('eth','btc','bch')),
        address TEXT NOT NULL,
        label TEXT,
        balance REAL,
        balance_asset TEXT,
        created_at TEXT NOT NULL,
        last_synced_at TEXT,
        xpub TEXT,
        script_type TEXT,
        UNIQUE (chain, address)
      );
      INSERT INTO wallets_new (
        id, chain, address, label, balance, balance_asset,
        created_at, last_synced_at, xpub, script_type
      )
      SELECT
        id, chain, address, label, balance, balance_asset,
        created_at, last_synced_at,
        ${hasColumn(db, "wallets", "xpub") ? "xpub" : "NULL"},
        ${hasColumn(db, "wallets", "script_type") ? "script_type" : "NULL"}
      FROM wallets;
      DROP TABLE wallets;
      ALTER TABLE wallets_new RENAME TO wallets;

      CREATE TABLE wallet_transfers_new (
        id TEXT PRIMARY KEY,
        wallet_id TEXT REFERENCES wallets(id) ON DELETE SET NULL,
        chain TEXT NOT NULL CHECK (chain IN ('eth','btc','bch')),
        asset TEXT NOT NULL,
        amount REAL NOT NULL,
        tx_hash TEXT NOT NULL UNIQUE,
        transferred_at TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('cryptocom','binance','manual')),
        import_batch_id TEXT,
        onchain_amount REAL,
        onchain_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (onchain_status IN ('pending','matched','mismatch','unresolved','weak')),
        notes TEXT,
        cost_basis REAL,
        cost_currency TEXT,
        cost_status TEXT NOT NULL DEFAULT 'unknown'
          CHECK (cost_status IN ('costed','partial','unknown','gift')),
        cost_notes TEXT
      );
      INSERT INTO wallet_transfers_new (
        id, wallet_id, chain, asset, amount, tx_hash, transferred_at,
        source, import_batch_id, onchain_amount, onchain_status, notes,
        cost_basis, cost_currency, cost_status, cost_notes
      )
      SELECT id, wallet_id, chain, asset, amount, tx_hash, transferred_at,
             source, import_batch_id, onchain_amount, onchain_status, notes,
             ${hasColumn(db, "wallet_transfers", "cost_basis") ? "cost_basis" : "NULL"},
             ${hasColumn(db, "wallet_transfers", "cost_currency") ? "cost_currency" : "NULL"},
             ${hasColumn(db, "wallet_transfers", "cost_status")
               ? "cost_status"
               : hasColumn(db, "wallet_transfers", "cost_basis")
                 ? "CASE WHEN cost_basis IS NOT NULL AND cost_basis > 0 THEN 'costed' ELSE 'unknown' END"
                 : "'unknown'"},
             ${hasColumn(db, "wallet_transfers", "cost_notes") ? "cost_notes" : "NULL"}
      FROM wallet_transfers;
      DROP TABLE wallet_transfers;
      ALTER TABLE wallet_transfers_new RENAME TO wallet_transfers;
    `);
  } finally {
    db.exec(`PRAGMA foreign_keys = ON`);
  }
}

function transferSourceAllowsBinance(db: Database.Database): boolean {
  try {
    db.prepare(
      `INSERT INTO wallet_transfers
         (id, chain, asset, amount, tx_hash, transferred_at, source, onchain_status)
       VALUES ('__src_probe__', 'eth', 'ETH', 0, '__src_probe_tx__', '1970-01-01', 'binance', 'pending')`,
    ).run();
    db.prepare(`DELETE FROM wallet_transfers WHERE id = '__src_probe__'`).run();
    return true;
  } catch {
    return false;
  }
}

/** Rebuild wallet_transfers when source CHECK still omits binance. */
function widenWalletTransferSource(db: Database.Database): void {
  if (!hasColumn(db, "wallet_transfers", "id")) return;
  if (transferSourceAllowsBinance(db)) return;

  db.exec(`PRAGMA foreign_keys = OFF`);
  try {
    db.exec(`
      CREATE TABLE wallet_transfers_new (
        id TEXT PRIMARY KEY,
        wallet_id TEXT REFERENCES wallets(id) ON DELETE SET NULL,
        chain TEXT NOT NULL CHECK (chain IN ('eth','btc','bch')),
        asset TEXT NOT NULL,
        amount REAL NOT NULL,
        tx_hash TEXT NOT NULL UNIQUE,
        transferred_at TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('cryptocom','binance','manual')),
        import_batch_id TEXT,
        onchain_amount REAL,
        onchain_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (onchain_status IN ('pending','matched','mismatch','unresolved','weak')),
        notes TEXT,
        cost_basis REAL,
        cost_currency TEXT,
        cost_status TEXT NOT NULL DEFAULT 'unknown'
          CHECK (cost_status IN ('costed','partial','unknown','gift')),
        cost_notes TEXT
      );
      INSERT INTO wallet_transfers_new (
        id, wallet_id, chain, asset, amount, tx_hash, transferred_at,
        source, import_batch_id, onchain_amount, onchain_status, notes,
        cost_basis, cost_currency, cost_status, cost_notes
      )
      SELECT id, wallet_id, chain, asset, amount, tx_hash, transferred_at,
             source, import_batch_id, onchain_amount, onchain_status, notes,
             ${hasColumn(db, "wallet_transfers", "cost_basis") ? "cost_basis" : "NULL"},
             ${hasColumn(db, "wallet_transfers", "cost_currency") ? "cost_currency" : "NULL"},
             ${hasColumn(db, "wallet_transfers", "cost_status")
               ? "cost_status"
               : hasColumn(db, "wallet_transfers", "cost_basis")
                 ? "CASE WHEN cost_basis IS NOT NULL AND cost_basis > 0 THEN 'costed' ELSE 'unknown' END"
                 : "'unknown'"},
             ${hasColumn(db, "wallet_transfers", "cost_notes") ? "cost_notes" : "NULL"}
      FROM wallet_transfers;
      DROP TABLE wallet_transfers;
      ALTER TABLE wallet_transfers_new RENAME TO wallet_transfers;
    `);
  } finally {
    db.exec(`PRAGMA foreign_keys = ON`);
  }
}
