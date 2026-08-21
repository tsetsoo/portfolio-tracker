import { describe, expect, it, vi } from "vitest";

import {
  createTelegramNotifier,
  formatAlertMessage,
  telegramConfigFromEnv,
} from "@/lib/alerts/telegram";
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
    lastCheckedAt: null,
    lastPrice: null,
    lastError: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("telegramConfigFromEnv", () => {
  it("returns null when either variable is missing", () => {
    expect(telegramConfigFromEnv({})).toBeNull();
    expect(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: "t" })).toBeNull();
    expect(telegramConfigFromEnv({ TELEGRAM_CHAT_ID: "1" })).toBeNull();
    expect(
      telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: "  ", TELEGRAM_CHAT_ID: "1" }),
    ).toBeNull();
  });

  it("returns a trimmed config when both are set", () => {
    expect(
      telegramConfigFromEnv({
        TELEGRAM_BOT_TOKEN: " 123:abc ",
        TELEGRAM_CHAT_ID: " 4242 ",
      }),
    ).toEqual({ botToken: "123:abc", chatId: "4242" });
  });
});

describe("createTelegramNotifier", () => {
  it("posts the message to the bot sendMessage endpoint", async () => {
    const fetchImpl = vi.fn(
      async (url: string, init: RequestInit) =>
        new Response("{}", { status: 200 }),
    );
    const notifier = createTelegramNotifier(
      { botToken: "123:abc", chatId: "4242" },
      fetchImpl as unknown as typeof fetch,
    );

    await notifier.send("hello");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: "4242",
      text: "hello",
      disable_web_page_preview: true,
    });
  });

  it("throws on a non-2xx response so the caller can retry", async () => {
    const fetchImpl = vi.fn(
      async (url: string, init: RequestInit) =>
        new Response("nope", { status: 429 }),
    );
    const notifier = createTelegramNotifier(
      { botToken: "123:abc", chatId: "4242" },
      fetchImpl as unknown as typeof fetch,
    );

    await expect(notifier.send("hello")).rejects.toThrow("429");
  });
});

describe("formatAlertMessage", () => {
  it("describes a crossed threshold and quotes the create-time price", () => {
    const text = formatAlertMessage(alert(), 105_240);
    expect(text).toContain("BTC");
    expect(text).toContain("crossed above");
    expect(text).toContain("€100,000.00");
    expect(text).toContain("€105,240.00");
    expect(text).toContain("€96,400.00");
  });

  it("describes a percent move with sign and baseline", () => {
    const text = formatAlertMessage(
      alert({
        kind: "percent_move",
        direction: "either",
        targetPrice: null,
        percent: 0.05,
        anchorPrice: 100_000,
      }),
      94_000,
    );
    expect(text).toContain("−6.00%");
    expect(text).toContain("€100,000.00");
    expect(text).toContain("€94,000.00");
  });

  it("includes the label when one is set", () => {
    expect(formatAlertMessage(alert({ label: "take profit" }), 105_240)).toContain(
      "take profit",
    );
  });

  it("shows a degraded message when percent_move has no baseline", () => {
    const text = formatAlertMessage(
      alert({
        kind: "percent_move",
        direction: "either",
        targetPrice: null,
        percent: 0.05,
        anchorPrice: null,
      }),
      94_000,
    );
    expect(text).toContain("BTC");
    expect(text).toContain("€94,000.00");
    expect(text).toContain("baseline unavailable");
    expect(text).not.toContain("crossed");
  });

  it("describes a threshold in the down direction", () => {
    const text = formatAlertMessage(
      alert({
        direction: "below",
        targetPrice: 50_000,
      }),
      45_000,
    );
    expect(text).toContain("BTC");
    expect(text).toContain("crossed below");
    expect(text).toContain("€50,000.00");
    expect(text).toContain("€45,000.00");
  });

  it("includes label in a percent_move alert", () => {
    const text = formatAlertMessage(
      alert({
        kind: "percent_move",
        direction: "either",
        targetPrice: null,
        percent: 0.05,
        anchorPrice: 100_000,
        label: "rebalance",
      }),
      110_000,
    );
    expect(text).toContain("+10.00%");
    expect(text).toContain("€100,000.00");
    expect(text).toContain("rebalance");
  });
});
