"use client";

import { useState, useTransition, type FormEvent } from "react";

import { resetPortfolioAction } from "@/app/actions/settings";

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
    <form className="settings-form reset-form" onSubmit={onSubmit}>
      <div className="form-heading">
        <p className="eyebrow">Danger zone</p>
        <h2>Reset portfolio data</h2>
      </div>
      <p>
        Permanently deletes all holdings, lots, net-worth snapshots, and import
        history. Base currency, price cache, and FX rates are kept.
      </p>
      <label htmlFor="reset-confirmation">
        Type RESET to confirm
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
      <small id="reset-hint">
        This cannot be undone. Re-import CSVs or re-add holdings afterward.
      </small>
      <div className="settings-control">
        <button
          className="danger-button reset-button"
          type="submit"
          disabled={!confirmed || isPending}
        >
          {isPending ? "Resetting…" : "Reset portfolio data"}
        </button>
      </div>
      {message && (
        <p className="form-note" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
