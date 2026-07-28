"use client";

import { useState, useTransition } from "react";

import {
  deletePastImport,
  renamePastImport,
} from "@/app/actions/import";
import type { ImportBatch } from "@/lib/import/batches";
import type { ImportBroker } from "@/lib/import/batch-names";

const BROKER_LABELS: Record<ImportBroker, string> = {
  ibkr: "Interactive Brokers",
  binance: "Binance",
  cryptocom: "Crypto.com",
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PastImports({ batches }: { batches: ImportBatch[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function startRename(batch: ImportBatch) {
    setEditingId(batch.id);
    setDraftName(batch.name);
    setMessage("");
  }

  function saveRename(id: string) {
    startTransition(async () => {
      try {
        await renamePastImport(id, draftName);
        setEditingId(null);
        setMessage("Import renamed.");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not rename import.",
        );
      }
    });
  }

  function removeHistory(id: string) {
    startTransition(async () => {
      try {
        await deletePastImport(id);
        setMessage("Import history row removed. Lots were kept.");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not delete import history.",
        );
      }
    });
  }

  if (batches.length === 0) {
    return (
      <section className="dashboard-panel past-imports-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2>Past imports</h2>
          </div>
        </div>
        <p className="form-note">
          Successful imports will appear here with the name you give them.
        </p>
      </section>
    );
  }

  return (
    <section className="dashboard-panel past-imports-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">History</p>
          <h2>Past imports</h2>
        </div>
        <span>{batches.length}</span>
      </div>

      <ul className="past-imports-list">
        {batches.map((batch) => (
          <li key={batch.id} className="past-import-row">
            <div className="past-import-main">
              {editingId === batch.id ? (
                <div className="past-import-rename">
                  <input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    aria-label="Import name"
                    disabled={isPending}
                  />
                  <button
                    className="primary-button"
                    type="button"
                    disabled={isPending || !draftName.trim()}
                    onClick={() => saveRename(batch.id)}
                  >
                    Save
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isPending}
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <h3>{batch.name}</h3>
              )}
              <p className="past-import-meta">
                {BROKER_LABELS[batch.broker]}
                {batch.sourceDetail ? ` · ${batch.sourceDetail}` : ""}
                {" · "}
                {formatWhen(batch.createdAt)}
              </p>
              {batch.fileNames.length > 0 && (
                <p className="past-import-files">
                  {batch.fileNames.join(", ")}
                </p>
              )}
              <p className="past-import-counts">
                {batch.lotsInserted} inserted · {batch.duplicates} duplicates ·{" "}
                {batch.closedCount} closed · {batch.skippedCount} skipped
                {batch.symbolsTouched.length > 0
                  ? ` · ${batch.symbolsTouched.join(", ")}`
                  : ""}
              </p>
            </div>
            {editingId !== batch.id && (
              <div className="past-import-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isPending}
                  onClick={() => startRename(batch)}
                >
                  Rename
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={isPending}
                  onClick={() => removeHistory(batch.id)}
                >
                  Remove history
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {message && (
        <p className="form-note" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
