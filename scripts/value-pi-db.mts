import Database from "better-sqlite3";
import { valuePortfolio } from "../lib/portfolio/value-portfolio.ts";

const path = process.argv[2] ?? "/tmp/pi-portfolio.db";
const db = new Database(path);
const v = await valuePortfolio(db, { forceRefresh: false });
for (const h of v.holdings.filter((x) => x.holding.type === "crypto")) {
  console.log(
    [
      h.holding.symbol,
      h.holding.quoteCurrency,
      h.quantity.toFixed(4),
      h.currentValueBase.toFixed(2),
      h.costBasisBase ?? "null",
    ].join("\t"),
  );
}
console.log("total", v.totalBase.toFixed(2), "outdated", v.pricesOutdated);
db.close();
