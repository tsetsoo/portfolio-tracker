import { describe, expect, it } from "vitest";

import { collectPurchaseDates } from "@/lib/import/collect-purchase-dates";

describe("collectPurchaseDates", () => {
  it("collects unique buy dates across Binance spot/convert/auto and CDC", () => {
    const spot =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n" +
      "2021-03-01 10:00:00,BTCEUR,BUY,40000,0.2BTC,8000EUR,0EUR\n" +
      "2021-03-02 11:00:00,BTCEUR,SELL,41000,0.05BTC,2050EUR,0EUR\n";
    const convert =
      "Time,Pair,Sell,Buy,Inverse Price,Status\n" +
      "2021-03-03 12:00:00,USDTETH,100USDT,0.05ETH,2000,Successful\n";
    const auto =
      "Time,Holding Coin,Amount Per Period,Units,Trading Fee,Status\n" +
      "2021-03-04 09:00:00,BTC,50USD,0.001BTC,0USD,Success\n";
    const cdc =
      "Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash\n" +
      "2021-03-05 08:00:00,Recurring Buy,EUR,-50,BTC,0.001,EUR,50,55,recurring_buy_order,\n";

    const dates = collectPurchaseDates({
      binanceSpotCsv: spot,
      binanceConvertCsv: convert,
      binanceAutoCsv: auto,
      cdcCsvs: [cdc],
    });

    // Spot SELL row's date is excluded (only BUY fills feed the collector).
    expect(dates).toEqual([
      "2021-03-01",
      "2021-03-03",
      "2021-03-04",
      "2021-03-05",
    ]);
  });

  it("returns no dates when given empty/undefined input", () => {
    expect(collectPurchaseDates({})).toEqual([]);
  });
});
