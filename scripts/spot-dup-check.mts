import { readFileSync } from "node:fs";
import { parseBinanceTradesCsv } from "../lib/binance/parse.ts";

const D = "/Users/tsvetelinpantev/Downloads";
const spot = parseBinanceTradesCsv(
  readFileSync(
    `${D}/Binance-Spot-Trade-History-202607271313(UTC+3)-part1-of1.csv`,
    "utf8",
  ),
);

const seen = new Map<string, (typeof spot.rows)[0]>();
const dups: typeof spot.rows = [];
for (const r of spot.rows) {
  const id = r.externalTradeId ?? "";
  if (seen.has(id)) dups.push(r);
  else seen.set(id, r);
}
console.log(
  "open lots",
  spot.rows.length,
  "unique ids",
  seen.size,
  "dup rows",
  dups.length,
);
for (const d of dups) {
  const first = seen.get(d.externalTradeId!)!;
  console.log("DUP id", d.externalTradeId);
  console.log(
    "  first",
    first.symbol,
    first.quantity,
    first.purchasedAt,
    first.costPerUnit,
    first.costCurrency,
  );
  console.log(
    "  dup  ",
    d.symbol,
    d.quantity,
    d.purchasedAt,
    d.costPerUnit,
    d.costCurrency,
  );
}

console.log("\nAll AVAX lots:");
for (const r of spot.rows.filter((r) => r.symbol === "AVAX")) {
  console.log(
    r.externalTradeId,
    r.quantity,
    r.purchasedAt,
    r.costPerUnit,
    r.costCurrency,
  );
}
