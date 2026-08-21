import type { PriceAlert } from "@/lib/alerts/types";
import { formatMoney } from "@/lib/format-money";

export interface AlertNotifier {
  send(text: string): Promise<void>;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export function telegramConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): TelegramConfig | null {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

export function createTelegramNotifier(
  config: TelegramConfig,
  fetchImpl: typeof fetch,
): AlertNotifier {
  return {
    async send(text: string): Promise<void> {
      const response = await fetchImpl(
        `https://api.telegram.org/bot${config.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: config.chatId,
            text,
            disable_web_page_preview: true,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Telegram sendMessage failed (${response.status})`);
      }
    },
  };
}

function formatPercent(move: number): string {
  const sign = move >= 0 ? "+" : "−";
  return `${sign}${(Math.abs(move) * 100).toFixed(2)}%`;
}

export function formatAlertMessage(alert: PriceAlert, price: number): string {
  const now = formatMoney(price, alert.currency);
  const lines: string[] = [];

  if (alert.kind === "threshold" && alert.targetPrice != null) {
    const target = formatMoney(alert.targetPrice, alert.currency);
    lines.push(`🔔 ${alert.symbol} ${now} — crossed ${alert.direction} ${target}`);
    if (alert.anchorPrice != null) {
      lines.push(
        `was ${formatMoney(alert.anchorPrice, alert.currency)} when you set this`,
      );
    }
  } else if (alert.kind === "percent_move") {
    if (alert.anchorPrice != null && alert.anchorPrice !== 0) {
      const move = (price - alert.anchorPrice) / alert.anchorPrice;
      lines.push(
        `🔔 ${alert.symbol} ${now} — ${formatPercent(move)} from ` +
          `${formatMoney(alert.anchorPrice, alert.currency)}`,
      );
    } else {
      lines.push(
        `🔔 ${alert.symbol} ${now} — baseline unavailable`,
      );
    }
  } else {
    lines.push(`🔔 ${alert.symbol} ${now}`);
  }

  if (alert.label) lines.push(alert.label);
  return lines.join("\n");
}
