"use server";

import { revalidatePath } from "next/cache";

import { createAlert, deleteAlert, setAlertEnabled } from "@/lib/alerts/repo";
import { resolveAlertSymbol } from "@/lib/alerts/resolve-symbol";
import { runAlertsNow, type RunAlertsResult } from "@/lib/alerts/run";
import {
  createTelegramNotifier,
  telegramConfigFromEnv,
} from "@/lib/alerts/telegram";
import type { AlertDirection, AlertKind } from "@/lib/alerts/types";
import { getDb } from "@/lib/db/client";
import { createQuoteService } from "@/lib/quotes/service";
import type { AssetClass } from "@/lib/quotes/types";
import { getSettings } from "@/lib/settings";

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface CreateAlertInput {
  symbol: string;
  assetClass: AssetClass;
  kind: AlertKind;
  direction: AlertDirection;
  targetPrice?: number;
  /** Whole percent as typed by the user: 5 means 5%. */
  percentWhole?: number;
  cooldownMinutes?: number;
  label?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function revalidateAlerts(): void {
  revalidatePath("/alerts");
}

export async function createAlertAction(
  input: CreateAlertInput,
): Promise<ActionResult> {
  try {
    // Cheap checks first: a typo'd form must not burn a rate-limited
    // CoinGecko/Yahoo call inside resolveAlertSymbol.
    if (input.kind === "threshold") {
      if (input.targetPrice == null || !Number.isFinite(input.targetPrice)) {
        return { ok: false, error: "A target price is required" };
      }
      if (input.targetPrice <= 0) {
        return { ok: false, error: "Target price must be above zero" };
      }
    } else {
      if (input.percentWhole == null || !Number.isFinite(input.percentWhole)) {
        return { ok: false, error: "A percentage is required" };
      }
      if (input.percentWhole <= 0) {
        return { ok: false, error: "Percentage must be above zero" };
      }
    }

    // A zero or negative cooldown makes inCooldown() always false, so a
    // crossed alert would fire on every pass forever. The form blocks it, but
    // this action is the trust boundary.
    if (input.cooldownMinutes != null) {
      if (
        !Number.isInteger(input.cooldownMinutes) ||
        input.cooldownMinutes < 1
      ) {
        return {
          ok: false,
          error: "Cooldown must be a whole number of minutes, at least 1",
        };
      }
    }

    const db = getDb();
    const { baseCurrency } = getSettings(db);
    const resolved = await resolveAlertSymbol(
      input.symbol,
      input.assetClass,
      baseCurrency,
      createQuoteService(db, globalThis.fetch),
    );

    // A zero anchor satisfies the anchor_price IS NOT NULL check but strands a
    // percent alert on "missing-anchor" forever.
    if (!Number.isFinite(resolved.price) || resolved.price <= 0) {
      return {
        ok: false,
        error: `Could not get a usable price for ${resolved.symbol}`,
      };
    }

    createAlert(db, {
      symbol: resolved.symbol,
      assetClass: input.assetClass,
      kind: input.kind,
      direction: input.direction,
      targetPrice: input.kind === "threshold" ? input.targetPrice : null,
      percent:
        input.kind === "percent_move" ? input.percentWhole! / 100 : null,
      anchorPrice: resolved.price,
      currency: resolved.currency,
      label: input.label,
      cooldownMinutes: input.cooldownMinutes,
    });

    revalidateAlerts();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function deleteAlertAction(id: string): Promise<void> {
  deleteAlert(getDb(), id);
  revalidateAlerts();
}

export async function toggleAlertAction(
  id: string,
  enabled: boolean,
): Promise<void> {
  setAlertEnabled(getDb(), id, enabled);
  revalidateAlerts();
}

export async function runAlertsNowAction(): Promise<RunAlertsResult> {
  const result = await runAlertsNow();
  revalidateAlerts();
  return result;
}

export async function sendTestMessageAction(): Promise<ActionResult> {
  const config = telegramConfigFromEnv();
  if (!config) {
    return {
      ok: false,
      error: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first",
    };
  }
  try {
    await createTelegramNotifier(config, globalThis.fetch).send(
      "✅ Portfolio Ledger test message — alerts are wired up.",
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
