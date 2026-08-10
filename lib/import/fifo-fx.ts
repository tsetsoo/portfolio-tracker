import type Database from "better-sqlite3";

import { getDailyFxRate } from "@/lib/import/fx-daily";
import {
  createFifoFxLookup,
  type FifoFxLookup,
} from "@/lib/import/fifo-net";
import { getSettings } from "@/lib/settings";

/** Build a sync FIFO FX lookup from settings + fx_rates (+ BGN peg fallback). */
export function fifoFxFromDb(db: Database.Database): FifoFxLookup {
  const baseCurrency = getSettings(db).baseCurrency;
  return createFifoFxLookup({
    baseCurrency,
    getRate: (from, to) => {
      const row = db
        .prepare(
          `SELECT rate
           FROM fx_rates
           WHERE UPPER(from_currency) = UPPER(?)
             AND UPPER(to_currency) = UPPER(?)
           LIMIT 1`,
        )
        .get(from, to) as { rate: number } | undefined;
      return row?.rate ?? null;
    },
    getDailyRate: (from, to, date) => getDailyFxRate(db, from, to, date),
  });
}
