"use client";

import { useEffect, useState, useTransition } from "react";

import {
  createAlertAction,
  deleteAlertAction,
  runAlertsNowAction,
  toggleAlertAction,
  type ActionResult,
  type CreateAlertInput,
} from "@/app/actions/alerts";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { FIELD_CONTROL } from "@/components/ui/Field";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { RunAlertsResult } from "@/lib/alerts/run";
import type { PriceAlert } from "@/lib/alerts/types";
import { formatMoney } from "@/lib/format-money";

type FormState = {
  symbol: string;
  assetClass: CreateAlertInput["assetClass"];
  kind: CreateAlertInput["kind"];
  direction: CreateAlertInput["direction"];
  targetPrice: string;
  percentWhole: string;
  cooldownMinutes: string;
  label: string;
  currency: string;
};

const DEFAULT_DIRECTION: Record<
  CreateAlertInput["kind"],
  CreateAlertInput["direction"]
> = {
  threshold: "above",
  percent_move: "either",
};

/**
 * The blank form to start from, or to return to after a successful create.
 * `currency` depends on `allowedAlertCurrencies(db)` (a server-computed prop,
 * not a module-level constant), so this is a function rather than the plain
 * object it used to be; `allowedCurrencies[0]` is always the base currency
 * (allowedAlertCurrencies puts it first).
 */
export function buildEmptyForm(allowedCurrencies: string[]): FormState {
  return {
    symbol: "",
    assetClass: "crypto",
    kind: "threshold",
    direction: DEFAULT_DIRECTION.threshold,
    targetPrice: "",
    percentWhole: "5",
    cooldownMinutes: "1440",
    label: "",
    currency: allowedCurrencies[0],
  };
}

/**
 * The submitted form state on a rejected create, unchanged so the user's
 * input survives (React 19 resets uncontrolled fields once the `action`
 * resolves regardless of outcome — controlling the inputs from `form` is
 * what keeps them from being wiped on failure). A successful create returns
 * to `emptyForm`, which is the one case where clearing is wanted.
 */
export function nextFormAfterCreate(
  current: FormState,
  result: ActionResult,
  emptyForm: FormState,
): FormState {
  return result.ok ? emptyForm : current;
}

/**
 * The next form state after the user switches alert kind. `direction` is
 * always reset to the new kind's default, never carried over from the old
 * one: threshold takes only `above`/`below` and percent_move only takes
 * `up`/`down`/`either`, so a direction valid for the old kind can be invalid
 * for the new one and would fail the SQL CHECK on submit. This used to be
 * guaranteed by remounting the direction `<select>` with `key={kind}`; that
 * remount is gone, so this reset is what preserves the guarantee now.
 */
export function nextFormAfterKindChange(
  current: FormState,
  nextKind: CreateAlertInput["kind"],
): FormState {
  return {
    ...current,
    kind: nextKind,
    direction: DEFAULT_DIRECTION[nextKind],
  };
}

/**
 * The `CreateAlertInput` a submitted form stands for. `currency` is the
 * form's own pick for every asset class, equities included: the create
 * action validates it against `allowedAlertCurrencies` server-side, and
 * `resolveAlertSymbol` proves the symbol actually quotes in it before the
 * alert is stored.
 */
export function buildCreateAlertInput(form: FormState): CreateAlertInput {
  const cooldownRaw = form.cooldownMinutes.trim();
  const input: CreateAlertInput = {
    symbol: form.symbol,
    assetClass: form.assetClass,
    kind: form.kind,
    direction: form.direction,
    currency: form.currency,
    cooldownMinutes: cooldownRaw === "" ? 1440 : Number(cooldownRaw),
    label: form.label.trim() || undefined,
  };
  if (form.kind === "threshold") {
    input.targetPrice = Number(form.targetPrice);
  } else {
    input.percentWhole = Number(form.percentWhole);
  }
  return input;
}

function describeRunResult(result: RunAlertsResult): string {
  if (result.skipped === "telegram-not-configured") {
    return "Skipped: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first.";
  }
  if (result.skipped === "already-running") {
    return "Skipped: a check is already in progress, try again shortly.";
  }
  return `Checked ${result.checked}, fired ${result.fired}, errors ${result.errors}.`;
}

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

/**
 * The part of an alert's status that never depends on the current time: a
 * disabled alert, a recorded error, or an alert that has never fired (and so
 * cannot be mid-cooldown) is exactly as "Armed"/"Disabled" on the server as
 * it will be on the client. Returns null when the answer genuinely depends
 * on "now" (fired at least once, still enabled, no error) — that case needs
 * describeStatus below.
 */
function timeAgnosticStatus(alert: PriceAlert): string | null {
  if (!alert.enabled) {
    return alert.lastError ? `Disabled — ${alert.lastError}` : "Disabled";
  }
  if (alert.lastError) return alert.lastError;
  if (!alert.lastFiredAt) return "Armed";
  return null;
}

export function describeStatus(alert: PriceAlert, now: number): string {
  const fixed = timeAgnosticStatus(alert);
  if (fixed !== null) return fixed;
  const readyAt =
    new Date(alert.lastFiredAt!).getTime() + alert.cooldownMinutes * 60_000;
  if (readyAt > now) {
    return `Cooling down until ${new Date(readyAt).toLocaleString()}`;
  }
  return "Armed";
}

/**
 * A deterministic, locale- and timezone-independent rendering of an ISO
 * instant, used for the first paint (server render and the client's initial
 * hydration render), which must match byte-for-byte or React logs a
 * hydration mismatch. `toLocaleString()` depends on the container's locale
 * and timezone on the server and the viewer's in the browser, so it cannot
 * be used until after mount confirms both renders already agree.
 */
export function formatInstantUtc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export function AlertsManager({
  alerts,
  allowedCurrencies,
  telegramConfigured,
}: {
  alerts: PriceAlert[];
  allowedCurrencies: string[];
  telegramConfigured: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    buildEmptyForm(allowedCurrencies),
  );
  // False on the server and on the client's first (pre-hydration) render, so
  // that render is identical in both places; flips true only after mount,
  // once it's safe to compute anything from Date.now() or toLocaleString().
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeKind(nextKind: CreateAlertInput["kind"]) {
    setForm((current) => nextFormAfterKindChange(current, nextKind));
  }

  function run(action: () => Promise<string | void>) {
    startTransition(async () => {
      try {
        const okMessage = await action();
        if (okMessage) setMessage(okMessage);
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Something went wrong.",
        );
      }
    });
  }

  function submit() {
    const input = buildCreateAlertInput(form);

    startTransition(async () => {
      const result = await createAlertAction(input);
      setMessage(result.ok ? "Alert created." : result.error);
      setForm((current) =>
        nextFormAfterCreate(current, result, buildEmptyForm(allowedCurrencies)),
      );
    });
  }

  const showCurrencyPicker = allowedCurrencies.length > 1;
  const displayCurrency = form.currency;

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
              <input
                name="symbol"
                required
                placeholder="BTC"
                value={form.symbol}
                onChange={(event) => updateForm("symbol", event.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Asset class</span>
              <select
                name="assetClass"
                value={form.assetClass}
                onChange={(event) =>
                  updateForm(
                    "assetClass",
                    event.target.value === "equity" ? "equity" : "crypto",
                  )
                }
              >
                <option value="crypto">Crypto</option>
                <option value="equity">Equity</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Kind</span>
              <select
                name="kind"
                value={form.kind}
                onChange={(event) =>
                  changeKind(event.target.value as CreateAlertInput["kind"])
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
                value={form.direction}
                onChange={(event) =>
                  updateForm(
                    "direction",
                    event.target.value as CreateAlertInput["direction"],
                  )
                }
              >
                {form.kind === "threshold" ? (
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
            {showCurrencyPicker && (
              <label className="grid gap-1.5">
                <span className="eyebrow">Currency</span>
                <select
                  name="currency"
                  value={form.currency}
                  onChange={(event) =>
                    updateForm("currency", event.target.value)
                  }
                >
                  {allowedCurrencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {form.kind === "threshold" ? (
              <label className="grid gap-1.5">
                <span className="eyebrow">Target price ({displayCurrency})</span>
                <input
                  name="targetPrice"
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={form.targetPrice}
                  onChange={(event) =>
                    updateForm("targetPrice", event.target.value)
                  }
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
                  required
                  value={form.percentWhole}
                  onChange={(event) =>
                    updateForm("percentWhole", event.target.value)
                  }
                />
              </label>
            )}
            <label className="grid gap-1.5">
              <span className="eyebrow">Cooldown (minutes)</span>
              <input
                name="cooldownMinutes"
                type="number"
                min="1"
                required
                value={form.cooldownMinutes}
                onChange={(event) =>
                  updateForm("cooldownMinutes", event.target.value)
                }
              />
            </label>
            <label className="grid gap-1.5 sm:col-span-2">
              <span className="eyebrow">Label (optional)</span>
              <input
                name="label"
                placeholder="take profit"
                value={form.label}
                onChange={(event) => updateForm("label", event.target.value)}
              />
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
                  setMessage(describeRunResult(result));
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
            exist in the CoinGecko map. Pick the currency the symbol actually
            trades in &mdash; a US listing quotes in USD, and asking for EUR
            makes the lookup try <code>.DE</code>/<code>.PA</code>/
            <code>.AS</code>/<code>.MI</code> first, which can resolve to a
            different instrument with the same ticker. There is no edit:
            change an alert by deleting and re-creating it, which resets a
            percent alert&rsquo;s baseline. An alert&rsquo;s currency is
            frozen at create time, so changing the portfolio base currency
            strands existing alerts on a currency mismatch until you
            re-create them.
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
                <th>Checked</th>
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
                <td className="text-dim">
                  {alert.lastCheckedAt == null
                    ? "—"
                    : mounted
                      ? new Date(alert.lastCheckedAt).toLocaleString()
                      : formatInstantUtc(alert.lastCheckedAt)}
                </td>
                <td
                  className={alert.lastError ? "text-warn" : "text-dim"}
                >
                  {mounted
                    ? describeStatus(alert, Date.now())
                    : timeAgnosticStatus(alert) ?? "—"}
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    <Button
                      disabled={isPending}
                      onClick={() =>
                        run(async () => {
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
                        run(async () => {
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
