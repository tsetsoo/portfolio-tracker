import { describe, expect, it } from "vitest";

import { evaluateAlert } from "@/lib/alerts/evaluate";
import type { PriceAlert } from "@/lib/alerts/types";
import type { Quote } from "@/lib/quotes/types";

const NOW = new Date("2026-08-21T12:00:00.000Z");

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: "alert-1",
    symbol: "BTC",
    assetClass: "crypto",
    kind: "threshold",
    direction: "above",
    targetPrice: 100_000,
    percent: null,
    anchorPrice: 96_400,
    anchorAt: "2026-08-01T00:00:00.000Z",
    currency: "EUR",
    label: null,
    enabled: true,
    cooldownMinutes: 1440,
    lastFiredAt: null,
    lastCheckedAt: null,
    lastPrice: null,
    lastError: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function quote(price: number, overrides: Partial<Quote> = {}): Quote {
  return {
    price,
    currency: "EUR",
    stale: false,
    fetchedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("evaluateAlert", () => {
  it("fires an above-threshold alert at or past the level", () => {
    expect(evaluateAlert(alert(), quote(100_000), NOW)).toEqual({
      fires: true,
      code: "fired",
      detail: null,
      nextAnchorPrice: null,
    });
    expect(evaluateAlert(alert(), quote(105_240), NOW).fires).toBe(true);
  });

  it("does not fire an above-threshold alert below the level", () => {
    expect(evaluateAlert(alert(), quote(99_999), NOW)).toEqual({
      fires: false,
      code: "not-crossed",
      detail: null,
      nextAnchorPrice: null,
    });
  });

  it("fires a below-threshold alert at or under the level", () => {
    const below = alert({ direction: "below", targetPrice: 90_000 });
    expect(evaluateAlert(below, quote(90_000), NOW).fires).toBe(true);
    expect(evaluateAlert(below, quote(89_000), NOW).fires).toBe(true);
    expect(evaluateAlert(below, quote(90_001), NOW).fires).toBe(false);
  });

  it("suppresses a crossed alert inside the cooldown window", () => {
    const cooling = alert({
      cooldownMinutes: 60,
      lastFiredAt: "2026-08-21T11:30:00.000Z",
    });
    expect(evaluateAlert(cooling, quote(105_240), NOW)).toEqual({
      fires: false,
      code: "cooldown",
      detail: null,
      nextAnchorPrice: null,
    });
  });

  it("fires again once the cooldown has elapsed", () => {
    const cooled = alert({
      cooldownMinutes: 60,
      lastFiredAt: "2026-08-21T10:59:00.000Z",
    });
    expect(evaluateAlert(cooled, quote(105_240), NOW).fires).toBe(true);
  });

  it("never fires on a stale quote, even when crossed", () => {
    const decision = evaluateAlert(
      alert(),
      quote(105_240, { stale: true }),
      NOW,
    );
    expect(decision.fires).toBe(false);
    expect(decision.code).toBe("stale-quote");
    expect(decision.detail).toContain("stale");
  });

  it("reports a currency mismatch instead of comparing", () => {
    const decision = evaluateAlert(
      alert(),
      quote(105_240, { currency: "USD" }),
      NOW,
    );
    expect(decision.fires).toBe(false);
    expect(decision.code).toBe("currency-mismatch");
    expect(decision.detail).toContain("USD");
    expect(decision.detail).toContain("EUR");
  });

  it("fires an either-direction percent alert on a move up or down", () => {
    const move = alert({
      kind: "percent_move",
      direction: "either",
      targetPrice: null,
      percent: 0.05,
      anchorPrice: 100_000,
    });

    expect(evaluateAlert(move, quote(105_000), NOW)).toEqual({
      fires: true,
      code: "fired",
      detail: null,
      nextAnchorPrice: 105_000,
    });
    expect(evaluateAlert(move, quote(95_000), NOW).fires).toBe(true);
    expect(evaluateAlert(move, quote(104_000), NOW).code).toBe("not-crossed");
  });

  it("respects percent direction", () => {
    const up = alert({
      kind: "percent_move",
      direction: "up",
      targetPrice: null,
      percent: 0.05,
      anchorPrice: 100_000,
    });
    expect(evaluateAlert(up, quote(106_000), NOW).fires).toBe(true);
    expect(evaluateAlert(up, quote(94_000), NOW).fires).toBe(false);

    const down = alert({
      kind: "percent_move",
      direction: "down",
      targetPrice: null,
      percent: 0.05,
      anchorPrice: 100_000,
    });
    expect(evaluateAlert(down, quote(94_000), NOW).fires).toBe(true);
    expect(evaluateAlert(down, quote(106_000), NOW).fires).toBe(false);
  });

  it("reports a missing anchor rather than dividing by zero", () => {
    const broken = alert({
      kind: "percent_move",
      direction: "either",
      targetPrice: null,
      percent: 0.05,
      anchorPrice: 0,
    });
    const decision = evaluateAlert(broken, quote(105_000), NOW);
    expect(decision.fires).toBe(false);
    expect(decision.code).toBe("missing-anchor");
  });
});
