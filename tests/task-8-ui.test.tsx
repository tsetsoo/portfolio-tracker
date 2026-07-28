import Database from "better-sqlite3";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HoldingForm } from "@/components/HoldingForm";
import { HoldingsManager } from "@/components/HoldingsManager";
import { ResetPortfolioForm } from "@/components/ResetPortfolioForm";
import { SettingsForm } from "@/components/SettingsForm";
import { migrate } from "@/lib/db/migrate";
import type { ValuedHolding } from "@/lib/domain/types";
import { getSettings, setBaseCurrency } from "@/lib/settings";

const valuedHolding: ValuedHolding = {
  holding: {
    id: "btc",
    type: "crypto",
    symbol: "BTC",
    name: "Bitcoin",
    quoteCurrency: "USD",
    manualValue: null,
    notes: null,
    updatedAt: "2026-07-25T10:00:00.000Z",
  },
  quantity: 0.25,
  avgCostPerUnit: 60000,
  currentValueBase: 17000,
  costBasisBase: 15000,
  unrealizedPlBase: 2000,
  unrealizedPlPct: 13.33,
};

const manualHolding: ValuedHolding = {
  holding: {
    id: "cash-1",
    type: "manual",
    symbol: null,
    name: "Emergency fund",
    quoteCurrency: "GBP",
    manualValue: 500,
    notes: null,
    updatedAt: "2026-07-25T10:00:00.000Z",
  },
  quantity: 0,
  avgCostPerUnit: null,
  currentValueBase: 600,
  costBasisBase: null,
  unrealizedPlBase: null,
  unrealizedPlPct: null,
};

describe("holdings management UI", () => {
  it("renders valued holdings with expandable lot details", () => {
    const html = renderToStaticMarkup(
      <HoldingsManager
        holdings={[valuedHolding]}
        lotsByHolding={{
          btc: [
            {
              id: "lot-1",
              holdingId: "btc",
              quantity: 0.25,
              costPerUnit: 60000,
              costCurrency: "USD",
              purchasedAt: "2026-07-01",
              fees: 12.5,
              externalTradeId: null,
              importBatchId: null,
            },
          ],
        }}
        currency="EUR"
      />,
    );

    expect(html).toContain("BTC");
    expect(html).toContain("€17,000.00");
    expect(html).toContain("<details");
    expect(html).toContain(" open");
    expect(html).toContain("Purchases");
    expect(html).toContain("0.25");
    expect(html).toContain("$60,000.00");
    expect(html).toContain("Units @ price");
    expect(html).toContain("Jul 1, 2026");
    expect(html).toContain("$12.50");
    expect(html).toContain('name="holdingId"');
    expect(html).toContain('value="btc"');
    expect(html).toContain("Delete");
  });

  it("renders an inline edit form for manual holdings and no units row", () => {
    const html = renderToStaticMarkup(
      <HoldingsManager
        holdings={[manualHolding]}
        lotsByHolding={{}}
        currency="EUR"
      />,
    );

    expect(html).toContain('name="manualValue"');
    expect(html).toContain('value="500"');
    expect(html).toContain("Save");
    expect(html).toContain("Delete");
    expect(html).toContain('value="cash-1"');
  });

  it("renders separate crypto and manual holding forms", () => {
    const html = renderToStaticMarkup(<HoldingForm />);

    expect(html).toContain("Add crypto");
    expect(html).toContain('name="symbol"');
    expect(html).toContain('name="quantity"');
    expect(html).toContain('name="costPerUnit"');
    expect(html).toContain('name="purchasedAt"');
    expect(html).toContain("Add manual asset");
    expect(html).toContain('name="manualValue"');
    expect(html.match(/min="0.00000001"/g)).toHaveLength(3);
  });
});

describe("base currency settings", () => {
  it("renders the current code in an uppercase input", () => {
    const html = renderToStaticMarkup(<SettingsForm baseCurrency="eur" />);

    expect(html).toContain('name="baseCurrency"');
    expect(html).toContain('value="EUR"');
    expect(html).toContain('maxLength="3"');
  });

  it("renders a reset control that documents what is wiped", () => {
    const html = renderToStaticMarkup(<ResetPortfolioForm />);

    expect(html).toContain("Reset portfolio data");
    expect(html).toContain("holdings");
    expect(html).toContain("snapshots");
    expect(html).toContain('name="confirmation"');
    expect(html).toContain("Type RESET to confirm");
  });

  it("normalizes valid ISO codes and rejects malformed codes", () => {
    const db = new Database(":memory:");
    migrate(db);

    setBaseCurrency(db, " usd ");
    expect(getSettings(db).baseCurrency).toBe("USD");
    expect(() => setBaseCurrency(db, "EURO")).toThrow(
      "Currency code must be three letters",
    );
    expect(() => setBaseCurrency(db, "12$")).toThrow(
      "Currency code must be three letters",
    );
  });
});
