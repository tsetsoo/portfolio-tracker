import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/alerts", () => ({
  createAlertAction: vi.fn(),
  deleteAlertAction: vi.fn(),
  toggleAlertAction: vi.fn(),
  runAlertsNowAction: vi.fn(),
}));

import { AlertsManager } from "@/components/AlertsManager";
import type { PriceAlert } from "@/lib/alerts/types";

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
    lastCheckedAt: "2026-08-21T12:00:00.000Z",
    lastPrice: 97_100,
    lastError: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AlertsManager", () => {
  it("renders the add form and a threshold row", () => {
    const html = renderToStaticMarkup(
      <AlertsManager alerts={[alert()]} telegramConfigured />,
    );

    expect(html).toContain("Add an alert");
    expect(html).toContain("BTC");
    expect(html).toContain("above €100,000.00");
    expect(html).toContain("€100,000.00");
    expect(html).toContain("€97,100.00");
    expect(html).toContain("Check now");
  });

  it("describes a percent alert as a percentage of its anchor", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[
          alert({
            kind: "percent_move",
            direction: "either",
            targetPrice: null,
            percent: 0.05,
            anchorPrice: 100_000,
          }),
        ]}
        telegramConfigured
      />,
    );

    expect(html).toContain("±5%");
    expect(html).toContain("€100,000.00");
  });

  it("warns when Telegram is not configured", () => {
    const html = renderToStaticMarkup(
      <AlertsManager alerts={[]} telegramConfigured={false} />,
    );
    expect(html).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("shows a recorded error and a disabled state", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[alert({ enabled: false, lastError: "no quote available" })]}
        telegramConfigured
      />,
    );
    expect(html).toContain("no quote available");
    expect(html).toContain("Enable");
  });

  it("says when nothing is set up yet", () => {
    const html = renderToStaticMarkup(
      <AlertsManager alerts={[]} telegramConfigured />,
    );
    expect(html).toContain("No alerts yet");
  });

  it("shows a cooldown message for an alert still inside its cooldown window", () => {
    const recentFire = new Date(Date.now() - 5 * 60_000).toISOString();
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[alert({ lastFiredAt: recentFire, cooldownMinutes: 1440 })]}
        telegramConfigured
      />,
    );
    expect(html).toContain("Cooling down until");
  });

  it("shows Armed once an alert's cooldown has elapsed", () => {
    const oldFire = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[alert({ lastFiredAt: oldFire, cooldownMinutes: 1440 })]}
        telegramConfigured
      />,
    );
    expect(html).toContain("Armed");
  });
});
