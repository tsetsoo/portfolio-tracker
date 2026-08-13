"use client";

import { useState, useTransition, type FormEvent } from "react";

import { resetPortfolioAction } from "@/app/actions/settings";
import { Button } from "@/components/ui/Button";
import { FIELD_CONTROL } from "@/components/ui/Field";

export function ResetPortfolioForm() {
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const confirmed = confirmation.trim() === "RESET";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await resetPortfolioAction(formData);
        setConfirmation("");
        setMessage("Portfolio data wiped. Settings and quote cache were kept.");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not reset portfolio data.",
        );
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`rounded-card border border-loss/25 bg-loss/5 p-5 ${FIELD_CONTROL}`}
    >
      <div className="border-b border-line pb-4">
        <p className="eyebrow text-loss/70">Danger zone</p>
        <h2 className="mt-1 text-base font-semibold tracking-tight">
          Reset portfolio data
        </h2>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-dim">
        Permanently deletes all holdings, lots, net-worth snapshots, and import
        history. Base currency, price cache, and FX rates are kept.
      </p>

      <label htmlFor="reset-confirmation" className="mt-4 grid max-w-xs gap-1.5">
        <span className="eyebrow">Type RESET to confirm</span>
        <input
          id="reset-confirmation"
          name="confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="RESET"
          aria-describedby="reset-hint"
        />
      </label>

      <small id="reset-hint" className="mt-2 block text-[11px] text-faint">
        This cannot be undone. Re-import CSVs or re-add holdings afterward.
      </small>

      <div className="mt-4">
        <Button type="submit" variant="danger" disabled={!confirmed || isPending}>
          {isPending ? "Resetting…" : "Reset portfolio data"}
        </Button>
      </div>

      {message && (
        <p className="mt-3 text-[11px] text-dim" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
