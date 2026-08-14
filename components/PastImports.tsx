"use client";

import { useState, useTransition } from "react";

import { deletePastImport, renamePastImport } from "@/app/actions/import";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FIELD_CONTROL } from "@/components/ui/Field";
import { SectionHeading } from "@/components/ui/SectionHeading";
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
      <Card className="mt-4">
        <SectionHeading eyebrow="History" title="Past imports" />
        <p className="px-5 py-6 text-[11px] text-dim">
          Successful imports will appear here with the name you give them.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <SectionHeading
        eyebrow="History"
        title="Past imports"
        meta={String(batches.length)}
      />

      <ul className="grid gap-3 p-5">
        {batches.map((batch) => (
          <li
            key={batch.id}
            className="grid items-start gap-3 rounded-lg border border-line bg-elevated/40 p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="grid min-w-0 gap-1">
              {editingId === batch.id ? (
                <div className={`flex flex-wrap gap-2 ${FIELD_CONTROL}`}>
                  <input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    aria-label="Import name"
                    disabled={isPending}
                    className="flex-1 min-w-[11.25rem]"
                  />
                  <Button
                    variant="primary"
                    disabled={isPending || !draftName.trim()}
                    onClick={() => saveRename(batch.id)}
                  >
                    Save
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={isPending}
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <h3 className="text-sm font-semibold">{batch.name}</h3>
              )}
              <p className="text-[11px] text-dim">
                {BROKER_LABELS[batch.broker]}
                {batch.sourceDetail ? ` · ${batch.sourceDetail}` : ""}
                {" · "}
                {formatWhen(batch.createdAt)}
              </p>
              {batch.fileNames.length > 0 && (
                <p className="font-mono text-[11px] break-words text-faint">
                  {batch.fileNames.join(", ")}
                </p>
              )}
              <p className="text-[11px] text-dim">
                {batch.lotsInserted} inserted · {batch.duplicates} duplicates ·{" "}
                {batch.closedCount} closed · {batch.skippedCount} skipped
                {batch.symbolsTouched.length > 0
                  ? ` · ${batch.symbolsTouched.join(", ")}`
                  : ""}
              </p>
            </div>

            {editingId !== batch.id && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => startRename(batch)}
                >
                  Rename
                </Button>
                <Button
                  variant="danger"
                  disabled={isPending}
                  onClick={() => removeHistory(batch.id)}
                >
                  Remove history
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {message && (
        <p className="px-5 pb-5 text-[11px] text-dim" role="status">
          {message}
        </p>
      )}
    </Card>
  );
}
