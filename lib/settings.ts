import type Database from "better-sqlite3";

import type { Settings } from "@/lib/domain/types";

interface SettingsRow {
  id: 1;
  base_currency: string;
}

export function getSettings(db: Database.Database): Settings {
  const row = db
    .prepare("SELECT id, base_currency FROM settings WHERE id = 1")
    .get() as SettingsRow;

  return { id: row.id, baseCurrency: row.base_currency };
}

export function setBaseCurrency(
  db: Database.Database,
  code: string,
): void {
  db.prepare("UPDATE settings SET base_currency = ? WHERE id = 1").run(
    code.toUpperCase(),
  );
}
