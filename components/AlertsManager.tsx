"use client";

import { useState, useTransition } from "react";

import {
  createAlertAction,
  deleteAlertAction,
  runAlertsNowAction,
  toggleAlertAction,
  type CreateAlertInput,
} from "@/app/actions/alerts";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { FIELD_CONTROL } from "@/components/ui/Field";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { PriceAlert } from "@/lib/alerts/types";
import { formatMoney } from "@/lib/format-money";

function describeCondition(alert: PriceAlert): string {
  if (alert.kind === "threshold" && alert.targetPrice != null) {
    return `${alert.direction} ${formatMoney(alert.targetPrice, alert.currency)}`;
  }
  if (alert.percent == null) return "—";
  const whole = Number((alert.percent * 100).toFixed(4));
  const sign =
    alert.direction === "up" ? "+" : alert.direction === "down" ? "−" : "±";
  return `${sign}${whole}%`;
}

function describeStatus(alert: PriceAlert, now: number): string {
  if (alert.lastError) return alert.lastError;
  if (!alert.enabled) return "Disabled";
  if (alert.lastFiredAt) {
    const readyAt =
      new Date(alert.lastFiredAt).getTime() + alert.cooldownMinutes * 60_000;
    if (readyAt > now) {
      return `Cooling down until ${new Date(readyAt).toLocaleString()}`;
    }
  }
  return "Armed";
}

export function AlertsManager({
  alerts,
  telegramConfigured,
}: {
  alerts: PriceAlert[];
  telegramConfigured: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<CreateAlertInput["kind"]>("threshold");
  const now = Date.now();

  function submit(formData: FormData) {
    const chosenKind = formData.get("kind") as CreateAlertInput["kind"];
    const input: CreateAlertInput = {
      symbol: String(formData.get("symbol") ?? ""),
      assetClass: formData.get("assetClass") === "equity" ? "equity" : "crypto",
      kind: chosenKind,
      direction: String(
        formData.get("direction") ?? "above",
      ) as CreateAlertInput["direction"],
      cooldownMinutes: Number(formData.get("cooldownMinutes") ?? 1440),
      label: String(formData.get("label") ?? "") || undefined,
    };
    if (chosenKind === "threshold") {
      input.targetPrice = Number(formData.get("targetPrice"));
    } else {
      input.percentWhole = Number(formData.get("percentWhole"));
    }

    startTransition(async () => {
      const result = await createAlertAction(input);
      setMessage(result.ok ? "Alert created." : result.error);
    });
  }

  return (
    <div className="grid gap-5">
      {!telegramConfigured && (
        <Card className="border-warn/40 p-4 text-[11px] leading-relaxed text-warn">
          Telegram is not configured, so nothing will be sent. Set
          TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID and restart the app.
        </Card>
      )}

      <Card>
        <SectionHeading title="Add an alert" />
        <form action={submit} className={`grid gap-3 p-5 ${FIELD_CONTROL}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="eyebrow">Symbol</span>
              <input name="symbol" required placeholder="BTC" />
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Asset class</span>
              <select name="assetClass" defaultValue="crypto">
                <option value="crypto">Crypto</option>
                <option value="equity">Equity</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Kind</span>
              <select
                name="kind"
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as CreateAlertInput["kind"])
                }
              >
                <option value="threshold">Price threshold</option>
                <option value="percent_move">Percent move</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Direction</span>
              <select
                name="direction"
                defaultValue={kind === "threshold" ? "above" : "either"}
                key={kind}
              >
                {kind === "threshold" ? (
                  <>
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                  </>
                ) : (
                  <>
                    <option value="either">Either way</option>
                    <option value="up">Up only</option>
                    <option value="down">Down only</option>
                  </>
                )}
              </select>
            </label>
            {kind === "threshold" ? (
              <label className="grid gap-1.5">
                <span className="eyebrow">Target price</span>
                <input
                  name="targetPrice"
                  type="number"
                  step="any"
                  min="0"
                  required
                />
              </label>
            ) : (
              <label className="grid gap-1.5">
                <span className="eyebrow">Move (%)</span>
                <input
                  name="percentWhole"
                  type="number"
                  step="any"
                  min="0"
                  defaultValue={5}
                  required
                />
              </label>
            )}
            <label className="grid gap-1.5">
              <span className="eyebrow">Cooldown (minutes)</span>
              <input name="cooldownMinutes" type="number" min="1" defaultValue={1440} />
            </label>
            <label className="grid gap-1.5 sm:col-span-2">
              <span className="eyebrow">Label (optional)</span>
              <input name="label" placeholder="take profit" />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="primary" type="submit" disabled={isPending}>
              Add alert
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await runAlertsNowAction();
                  setMessage(
                    result.skipped
                      ? `Skipped: ${result.skipped}`
                      : `Checked ${result.checked}, fired ${result.fired}, errors ${result.errors}.`,
                  );
                })
              }
            >
              Check now
            </Button>
            {message && (
              <span className="text-[11px] text-dim">{message}</span>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-faint">
            The price is fetched now: a percent alert measures from it, and a
            threshold alert quotes it in the notification. Crypto symbols must
            exist in the CoinGecko map.
          </p>
        </form>
      </Card>

      <Card>
        <SectionHeading title="Alerts" />
        {alerts.length === 0 ? (
          <p className="p-5 text-[11px] text-dim">
            No alerts yet. Add one above.
          </p>
        ) : (
          <DataTable
            head={
              <tr>
                <th>Symbol</th>
                <th>Condition</th>
                <th className="numeric">Reference</th>
                <th className="numeric">Last price</th>
                <th>Status</th>
                <th />
              </tr>
            }
          >
            {alerts.map((alert) => (
              <tr key={alert.id}>
                <td>
                  <span className="font-mono">{alert.symbol}</span>
                  {alert.label && (
                    <span className="ml-2 text-[10px] text-faint">
                      {alert.label}
                    </span>
                  )}
                </td>
                <td>{describeCondition(alert)}</td>
                <td className="numeric">
                  {alert.anchorPrice == null
                    ? "—"
                    : formatMoney(alert.anchorPrice, alert.currency)}
                </td>
                <td className="numeric">
                  {alert.lastPrice == null
                    ? "—"
                    : formatMoney(alert.lastPrice, alert.currency)}
                </td>
                <td
                  className={alert.lastError ? "text-warn" : "text-dim"}
                >
                  {describeStatus(alert, now)}
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    <Button
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          await toggleAlertAction(alert.id, !alert.enabled);
                        })
                      }
                    >
                      {alert.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          await deleteAlertAction(alert.id);
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
