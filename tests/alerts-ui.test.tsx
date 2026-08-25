import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/alerts", () => ({
  createAlertAction: vi.fn(),
  deleteAlertAction: vi.fn(),
  toggleAlertAction: vi.fn(),
  runAlertsNowAction: vi.fn(),
}));

import {
  AlertsManager,
  buildCreateAlertInput,
  buildEmptyForm,
  describeStatus,
  formatInstantUtc,
  nextFormAfterCreate,
  nextFormAfterKindChange,
} from "@/components/AlertsManager";
import type { PriceAlert } from "@/lib/alerts/types";

const ALLOWED_CURRENCIES = ["EUR", "USD"];

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
      <AlertsManager
        alerts={[alert()]}
        allowedCurrencies={ALLOWED_CURRENCIES}
        telegramConfigured
      />,
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
        allowedCurrencies={ALLOWED_CURRENCIES}
        telegramConfigured
      />,
    );

    expect(html).toContain("±5%");
    expect(html).toContain("€100,000.00");
  });

  it("offers the currency picker whenever more than one currency is allowed", () => {
    // The gate is the currency list alone now; it used to also require the
    // asset class to be crypto.
    const withChoice = renderToStaticMarkup(
      <AlertsManager
        alerts={[]}
        allowedCurrencies={["EUR", "USD"]}
        telegramConfigured
      />,
    );
    expect(withChoice).toContain('name="currency"');

    const noChoice = renderToStaticMarkup(
      <AlertsManager alerts={[]} allowedCurrencies={["EUR"]} telegramConfigured />,
    );
    expect(noChoice).not.toContain('name="currency"');
  });

  it("warns when Telegram is not configured", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[]}
        allowedCurrencies={ALLOWED_CURRENCIES}
        telegramConfigured={false}
      />,
    );
    expect(html).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("shows a recorded error and a disabled state", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[alert({ enabled: false, lastError: "no quote available" })]}
        allowedCurrencies={ALLOWED_CURRENCIES}
        telegramConfigured
      />,
    );
    expect(html).toContain("no quote available");
    expect(html).toContain("Enable");
  });

  it("says when nothing is set up yet", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[]}
        allowedCurrencies={ALLOWED_CURRENCIES}
        telegramConfigured
      />,
    );
    expect(html).toContain("No alerts yet");
  });

  it("describeStatus reports a cooldown message for an alert still inside its window", () => {
    const recentFire = new Date(Date.now() - 5 * 60_000).toISOString();
    const status = describeStatus(
      alert({ lastFiredAt: recentFire, cooldownMinutes: 1440 }),
      Date.now(),
    );
    expect(status).toContain("Cooling down until");
  });

  it("describeStatus reports Armed once an alert's cooldown has elapsed", () => {
    const oldFire = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const status = describeStatus(
      alert({ lastFiredAt: oldFire, cooldownMinutes: 1440 }),
      Date.now(),
    );
    expect(status).toBe("Armed");
  });

  it(
    "renders a stable pre-mount placeholder for a fired alert's status, " +
      "since Cooling-down-vs-Armed depends on the client's clock",
    () => {
      const recentFire = new Date(Date.now() - 5 * 60_000).toISOString();
      const oldFire = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();

      const coolingHtml = renderToStaticMarkup(
        <AlertsManager
          alerts={[alert({ lastFiredAt: recentFire, cooldownMinutes: 1440 })]}
          allowedCurrencies={ALLOWED_CURRENCIES}
          telegramConfigured
        />,
      );
      const armedHtml = renderToStaticMarkup(
        <AlertsManager
          alerts={[alert({ lastFiredAt: oldFire, cooldownMinutes: 1440 })]}
          allowedCurrencies={ALLOWED_CURRENCIES}
          telegramConfigured
        />,
      );

      // The server (and the client's pre-hydration render) cannot honestly
      // tell these two rows apart without a shared clock, so both render the
      // same neutral placeholder — never "Cooling down until ..." or
      // "Armed", which would only be true on one side of the mount.
      expect(coolingHtml).not.toContain("Cooling down until");
      expect(coolingHtml).not.toContain(">Armed<");
      expect(armedHtml).not.toContain("Cooling down until");
      expect(armedHtml).not.toContain(">Armed<");
    },
  );

  it("formatInstantUtc renders an ISO instant deterministically, independent of locale/timezone", () => {
    expect(formatInstantUtc("2026-08-21T12:34:00.000Z")).toBe(
      "2026-08-21 12:34 UTC",
    );
  });

  it("renders the Checked column pre-mount using the deterministic UTC format, or an em-dash when null", () => {
    const checkedAt = "2026-08-21T12:00:00.000Z";
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[alert({ lastCheckedAt: checkedAt })]}
        allowedCurrencies={ALLOWED_CURRENCIES}
        telegramConfigured
      />,
    );
    expect(html).toContain(formatInstantUtc(checkedAt));
    // Never the locale-dependent format pre-mount: that's exactly the string
    // that would differ between the server's container and the viewer's
    // browser and produce a hydration mismatch.
    expect(html).not.toContain(new Date(checkedAt).toLocaleString());

    const htmlNull = renderToStaticMarkup(
      <AlertsManager
        alerts={[alert({ lastCheckedAt: null })]}
        allowedCurrencies={ALLOWED_CURRENCIES}
        telegramConfigured
      />,
    );
    expect(htmlNull).toContain("—");
  });

  it("nextFormAfterCreate preserves the submitted form on failure, and clears it on success", () => {
    const typed = {
      symbol: "FOO",
      assetClass: "crypto" as const,
      kind: "threshold" as const,
      direction: "above" as const,
      targetPrice: "123.45",
      percentWhole: "5",
      cooldownMinutes: "60",
      label: "take profit",
      currency: "USD",
    };
    const empty = buildEmptyForm(ALLOWED_CURRENCIES);

    const afterFailure = nextFormAfterCreate(
      typed,
      {
        ok: false,
        error:
          "The price for FOO could not be refreshed right now. Try again shortly.",
      },
      empty,
    );
    expect(afterFailure).toEqual(typed);

    const afterSuccess = nextFormAfterCreate(typed, { ok: true }, empty);
    expect(afterSuccess).not.toEqual(typed);
    expect(afterSuccess.symbol).toBe("");
    expect(afterSuccess.targetPrice).toBe("");
    expect(afterSuccess.label).toBe("");
    expect(afterSuccess.currency).toBe("EUR");
  });

  it("buildEmptyForm defaults currency to the first allowed currency (the base currency)", () => {
    expect(buildEmptyForm(["EUR", "USD"]).currency).toBe("EUR");
    expect(buildEmptyForm(["USD", "EUR"]).currency).toBe("USD");
  });


  it("carries the form's currency onto an equity alert, not the base currency", () => {
    // Equities were pinned to allowedCurrencies[0] (the base currency), which
    // made every USD level on a US listing uncreatable: with EUR forced,
    // yahooSymbolCandidates hunts .DE/.PA/.AS/.MI ahead of the bare ticker.
    const input = buildCreateAlertInput({
      ...buildEmptyForm(["EUR", "USD"]),
      symbol: "TSLA",
      assetClass: "equity",
      kind: "threshold",
      direction: "below",
      targetPrice: "280",
      currency: "USD",
    });

    expect(input.currency).toBe("USD");
    expect(input.assetClass).toBe("equity");
    expect(input.targetPrice).toBe(280);
  });

  it("still carries the form's currency for crypto", () => {
    const input = buildCreateAlertInput({
      ...buildEmptyForm(["EUR", "USD"]),
      symbol: "BTC",
      currency: "USD",
      targetPrice: "60000",
      direction: "below",
    });

    expect(input.currency).toBe("USD");
    expect(input.assetClass).toBe("crypto");
  });

  it("nextFormAfterKindChange resets direction to a value valid for the new kind", () => {
    // threshold -> percent_move: "below" is not a valid percent_move
    // direction (only up/down/either are), so it must not survive the switch.
    const fromThreshold = nextFormAfterKindChange(
      {
        symbol: "BTC",
        assetClass: "crypto",
        kind: "threshold",
        direction: "below",
        targetPrice: "100000",
        percentWhole: "5",
        cooldownMinutes: "1440",
        label: "",
        currency: "EUR",
      },
      "percent_move",
    );
    expect(fromThreshold.kind).toBe("percent_move");
    expect(["up", "down", "either"]).toContain(fromThreshold.direction);

    // percent_move -> threshold: "up" is not a valid threshold direction
    // (only above/below are), so it must not survive the switch either.
    const fromPercent = nextFormAfterKindChange(
      {
        symbol: "ETH",
        assetClass: "crypto",
        kind: "percent_move",
        direction: "up",
        targetPrice: "",
        percentWhole: "5",
        cooldownMinutes: "1440",
        label: "",
        currency: "EUR",
      },
      "threshold",
    );
    expect(fromPercent.kind).toBe("threshold");
    expect(["above", "below"]).toContain(fromPercent.direction);
  });

  it("shows both Disabled and the error for a disabled alert with a lastError", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[alert({ enabled: false, lastError: "no quote available" })]}
        allowedCurrencies={ALLOWED_CURRENCIES}
        telegramConfigured
      />,
    );
    expect(html).toContain("Disabled");
    expect(html).toContain("no quote available");
    expect(html).toContain("Disabled — no quote available");
  });

  it("shows plain Disabled for a disabled alert with no error", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[alert({ enabled: false, lastError: null })]}
        allowedCurrencies={ALLOWED_CURRENCIES}
        telegramConfigured
      />,
    );
    expect(html).toContain("Disabled");
    expect(html).not.toContain("Disabled —");
  });

  it("shows Armed immediately, even pre-mount, for an alert that has never fired", () => {
    // Never having fired means it cannot be mid-cooldown, so this doesn't
    // depend on "now" and is safe to render before mount too.
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[alert({ lastFiredAt: null })]}
        allowedCurrencies={ALLOWED_CURRENCIES}
        telegramConfigured
      />,
    );
    expect(html).toContain("Armed");
  });

  it("renders a currency select for the (default, crypto) create form, base currency first and selected", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[]}
        allowedCurrencies={["EUR", "USD"]}
        telegramConfigured
      />,
    );
    expect(html).toContain('name="currency"');
    // React's SSR marks the option matching the controlled <select>'s value
    // with `selected=""`, so this also proves EUR (the base currency) is
    // pre-selected, not merely present.
    const eurIndex = html.indexOf('<option value="EUR" selected="">EUR</option>');
    const usdIndex = html.indexOf('<option value="USD">USD</option>');
    expect(eurIndex).toBeGreaterThan(-1);
    expect(usdIndex).toBeGreaterThan(eurIndex);
  });

  it("hides the currency select when only one currency is allowed", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[]}
        allowedCurrencies={["EUR"]}
        telegramConfigured
      />,
    );
    expect(html).not.toContain('name="currency"');
  });

  it("labels the target-price field with the currency the alert will actually use", () => {
    const eurFirst = renderToStaticMarkup(
      <AlertsManager
        alerts={[]}
        allowedCurrencies={["EUR", "USD"]}
        telegramConfigured
      />,
    );
    expect(eurFirst).toContain("Target price (EUR)");

    const usdFirst = renderToStaticMarkup(
      <AlertsManager
        alerts={[]}
        allowedCurrencies={["USD", "EUR"]}
        telegramConfigured
      />,
    );
    expect(usdFirst).toContain("Target price (USD)");
  });

  it("renders each alert's own currency in the table, even when they differ", () => {
    const html = renderToStaticMarkup(
      <AlertsManager
        alerts={[
          alert({ id: "eur-alert", symbol: "BTC", currency: "EUR" }),
          alert({ id: "usd-alert", symbol: "ETH", currency: "USD" }),
        ]}
        allowedCurrencies={ALLOWED_CURRENCIES}
        telegramConfigured
      />,
    );
    expect(html).toContain("above €100,000.00");
    expect(html).toContain("above $100,000.00");
    expect(html).toContain("€97,100.00");
    expect(html).toContain("$97,100.00");
  });
});
