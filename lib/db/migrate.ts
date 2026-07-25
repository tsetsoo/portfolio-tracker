import type Database from "better-sqlite3";

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
      external_trade_id TEXT UNIQUE
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
  `);
}
