import type { PriceAlert } from "@/lib/alerts/types";
import type { Quote } from "@/lib/quotes/types";

export type AlertDecisionCode =
  | "fired"
  | "cooldown"
  | "not-crossed"
  | "stale-quote"
  | "currency-mismatch"
  | "missing-anchor";

export interface AlertDecision {
  fires: boolean;
  code: AlertDecisionCode;
  /** Text for last_error. Null when nothing went wrong. */
  detail: string | null;
  /** Re-anchor target for percent alerts; null leaves the anchor alone. */
  nextAnchorPrice: number | null;
}

function decision(
  code: AlertDecisionCode,
  detail: string | null = null,
): AlertDecision {
  return { fires: false, code, detail, nextAnchorPrice: null };
}

function inCooldown(alert: PriceAlert, now: Date): boolean {
  if (!alert.lastFiredAt) return false;
  const elapsedMs = now.getTime() - new Date(alert.lastFiredAt).getTime();
  return elapsedMs < alert.cooldownMinutes * 60_000;
}

export function evaluateAlert(
  alert: PriceAlert,
  quote: Quote,
  now: Date,
): AlertDecision {
  // A stale quote means the provider failed and the service served cache.
  // A stale price crossing a level is not news.
  if (quote.stale) {
    return decision(
      "stale-quote",
      `Quote for ${alert.symbol} is stale (fetched ${quote.fetchedAt})`,
    );
  }

  const quoteCurrency = quote.currency.trim().toUpperCase();
  if (quoteCurrency !== alert.currency) {
    return decision(
      "currency-mismatch",
      `Quote currency ${quoteCurrency} does not match alert currency ${alert.currency}`,
    );
  }

  if (inCooldown(alert, now)) {
    return decision("cooldown");
  }

  if (alert.kind === "threshold") {
    const target = alert.targetPrice;
    if (target == null) {
      return decision("missing-anchor", "Threshold alert has no target price");
    }
    const crossed =
      alert.direction === "above" ? quote.price >= target : quote.price <= target;
    return crossed
      ? { fires: true, code: "fired", detail: null, nextAnchorPrice: null }
      : decision("not-crossed");
  }

  const anchor = alert.anchorPrice;
  if (anchor == null || anchor === 0) {
    return decision(
      "missing-anchor",
      `Percent alert for ${alert.symbol} has no usable anchor price`,
    );
  }

  const percent = alert.percent;
  if (percent == null) {
    return decision("missing-anchor", "Percent alert has no percentage");
  }

  const move = (quote.price - anchor) / anchor;
  const bigEnough = Math.abs(move) >= percent;
  const directionMatches =
    alert.direction === "either" ||
    (alert.direction === "up" && move > 0) ||
    (alert.direction === "down" && move < 0);

  if (!bigEnough || !directionMatches) {
    return decision("not-crossed");
  }

  return {
    fires: true,
    code: "fired",
    detail: null,
    nextAnchorPrice: quote.price,
  };
}
