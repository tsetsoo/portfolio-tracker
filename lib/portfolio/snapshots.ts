import type Database from "better-sqlite3";

import type { PortfolioValuation } from "@/lib/domain/types";

interface SnapshotRow {
  date: string;
  total_base: number;
}

export function ensureTodaySnapshot(
  db: Database.Database,
  valuation: PortfolioValuation,
  today: string,
): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO snapshots (date, total_base, breakdown_json)
       VALUES (?, ?, ?)`,
    )
    .run(today, valuation.totalBase, JSON.stringify(valuation.holdings));

  return result.changes === 1;
}

export function listSnapshots(
  db: Database.Database,
): { date: string; totalBase: number }[] {
  const rows = db
    .prepare("SELECT date, total_base FROM snapshots ORDER BY date")
    .all() as SnapshotRow[];

  return rows.map((row) => ({
    date: row.date,
    totalBase: row.total_base,
  }));
}
