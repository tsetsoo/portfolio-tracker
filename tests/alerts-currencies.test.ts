import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { allowedAlertCurrencies } from "@/lib/alerts/currencies";
import { migrate } from "@/lib/db/migrate";

const databases: Database.Database[] = [];

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("allowedAlertCurrencies", () => {
  it("returns fiat lot currencies plus base, base first, excluding crypto denominations", () => {
    const db = makeDb();
    db.exec(`
      UPDATE settings SET base_currency = 'EUR' WHERE id = 1;
      INSERT INTO holdings
        (id, type, symbol, name, quote_currency, manual_value, notes, updated_at)
      VALUES
        ('equity-1', 'equity', 'ACME', 'Acme Corp', 'USD', NULL, NULL, '2026-07-20'),
        ('crypto-1', 'crypto', 'BTC', 'Bitcoin', 'EUR', NULL, NULL, '2026-07-20'),
        ('crypto-2', 'crypto', 'CRO', 'Cronos', 'USD', NULL, NULL, '2026-07-20');
      INSERT INTO lots
        (id, holding_id, quantity, cost_per_unit, cost_currency, purchased_at, fees)
      VALUES
        ('lot-eur', 'crypto-1', 1, 10000, 'EUR', '2025-01-01', 0),
        ('lot-usd', 'equity-1', 10, 80, 'USD', '2025-01-01', 0),
        ('lot-usdt', 'crypto-2', 100, 1, 'USDT', '2025-01-01', 0),
        ('lot-cro', 'crypto-2', 500, 1, 'CRO', '2025-01-01', 0),
        ('lot-bnb', 'crypto-2', 2, 300, 'BNB', '2025-01-01', 0);
    `);

    expect(allowedAlertCurrencies(db)).toEqual(["EUR", "USD"]);
  });

  it("includes the base currency even when no lot uses it", () => {
    const db = makeDb();
    db.exec(`
      UPDATE settings SET base_currency = 'EUR' WHERE id = 1;
      INSERT INTO holdings
        (id, type, symbol, name, quote_currency, manual_value, notes, updated_at)
      VALUES
        ('equity-1', 'equity', 'ACME', 'Acme Corp', 'USD', NULL, NULL, '2026-07-20');
      INSERT INTO lots
        (id, holding_id, quantity, cost_per_unit, cost_currency, purchased_at, fees)
      VALUES
        ('lot-usd', 'equity-1', 10, 80, 'USD', '2025-01-01', 0);
    `);

    expect(allowedAlertCurrencies(db)).toEqual(["EUR", "USD"]);
  });

  it("omits a non-ISO base currency instead of offering it unchecked", () => {
    const db = makeDb();
    db.exec(`
      UPDATE settings SET base_currency = 'XYZ' WHERE id = 1;
      INSERT INTO holdings
        (id, type, symbol, name, quote_currency, manual_value, notes, updated_at)
      VALUES
        ('equity-1', 'equity', 'ACME', 'Acme Corp', 'USD', NULL, NULL, '2026-07-20');
      INSERT INTO lots
        (id, holding_id, quantity, cost_per_unit, cost_currency, purchased_at, fees)
      VALUES
        ('lot-usd', 'equity-1', 10, 80, 'USD', '2025-01-01', 0);
    `);

    expect(allowedAlertCurrencies(db)).toEqual(["USD"]);
  });
});
