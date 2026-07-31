import { readFileSync } from "node:fs";
import {
  parseBinanceAutoInvestCsv,
  parseBinanceTradesCsv,
} from "../lib/binance/parse.ts";
import { parseCryptoComTradesCsv } from "../lib/cryptocom/parse.ts";
import { parseIbkrTradesCsv } from "../lib/ibkr/parse.ts";
import { combineCsvTexts } from "../lib/import/combine-csv.ts";

function summarize(
  label: string,
  rows: {
    symbol: string;
    quantity: number;
    costCurrency: string;
    externalTradeId: string | null;
  }[],
  errors: { line: number; message: string }[],
) {
  const bySym = new Map<string, { n: number; qty: number }>();
  for (const r of rows) {
    const s = r.symbol.toUpperCase();
    const cur = bySym.get(s) ?? { n: 0, qty: 0 };
    cur.n += 1;
    cur.qty += r.quantity;
    bySym.set(s, cur);
  }
  const errCounts = new Map<string, number>();
  for (const e of errors) {
    const key = e.message.slice(0, 80);
    errCounts.set(key, (errCounts.get(key) ?? 0) + 1);
  }
  console.log(`\n=== ${label} ===`);
  console.log(`open_lots=${rows.length} parse_notes/errors=${errors.length}`);
  console.log(
    "symbols:",
    [...bySym.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([s, v]) => `${s}:${v.n}lots/qty=${Number(v.qty.toFixed(10))}`)
      .join(" | "),
  );
  console.log(
    "note buckets:",
    [...errCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([k, n]) => `${n}x ${k}`)
      .join(" | "),
  );
  const ccys = new Map<string, number>();
  for (const r of rows) {
    ccys.set(r.costCurrency, (ccys.get(r.costCurrency) ?? 0) + 1);
  }
  console.log(
    "cost currencies:",
    [...ccys.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c}:${n}`)
      .join(", "),
  );
  return bySym;
}

const D = "/Users/tsvetelinpantev/Downloads";

const ibkr = parseIbkrTradesCsv(
  readFileSync(`${D}/U23181408.TRANSACTIONS.1Y.csv`, "utf8"),
);
summarize("IBKR", ibkr.rows, ibkr.errors);

const cdcCombined = combineCsvTexts([
  readFileSync(`${D}/crypto_transactions_record_20260727_111330.csv`, "utf8"),
  readFileSync(`${D}/crypto_transactions_record_20260727_111249.csv`, "utf8"),
]);
const cdc = parseCryptoComTradesCsv(cdcCombined);
summarize("CDC combined", cdc.rows, cdc.errors);

const spot = parseBinanceTradesCsv(
  readFileSync(
    `${D}/Binance-Spot-Trade-History-202607271313(UTC+3)-part1-of1.csv`,
    "utf8",
  ),
);
summarize("Binance Spot", spot.rows, spot.errors);

const auto = parseBinanceAutoInvestCsv(
  readFileSync(
    `${D}/Binance-Auto-Invest-History-202607271314(UTC+3)-part1-of1.csv`,
    "utf8",
  ),
);
summarize("Binance Auto-Invest", auto.rows, auto.errors);

const autoEmpty = parseBinanceAutoInvestCsv(
  readFileSync(
    `${D}/Binance-Auto-Invest-History-202607271315(UTC+3).csv`,
    "utf8",
  ),
);
summarize("Binance Auto-Invest EMPTY 1315", autoEmpty.rows, autoEmpty.errors);

console.log("\n=== EXPECTED OPEN QTY BY SYMBOL (parser open lots) ===");
const all = new Map<string, { qty: number; lots: number; sources: Set<string> }>();
for (const [src, parsed] of [
  ["ibkr", ibkr],
  ["cdc", cdc],
  ["spot", spot],
  ["auto", auto],
] as const) {
  for (const r of parsed.rows) {
    const s = r.symbol.toUpperCase();
    const cur = all.get(s) ?? { qty: 0, lots: 0, sources: new Set() };
    cur.qty += r.quantity;
    cur.lots += 1;
    cur.sources.add(src);
    all.set(s, cur);
  }
}
for (const [s, v] of [...all.entries()].sort()) {
  console.log(
    `${s}\tlots=${v.lots}\tqty=${Number(v.qty.toFixed(10))}\tsources=${[...v.sources].join(",")}`,
  );
}
