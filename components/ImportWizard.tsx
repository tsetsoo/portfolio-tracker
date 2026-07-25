"use client";

import { useRef, useState, useTransition } from "react";

import {
  commitIbkrRows,
  previewIbkrCsv,
} from "@/app/actions/import";
import type { IbkrImportPreview } from "@/lib/ibkr/commit";

import styles from "./ImportWizard.module.css";

export function ImportWizard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<IbkrImportPreview | null>(null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function chooseFile(file: File | undefined) {
    setPreview(null);
    setMessage("");
    setFileName(file?.name ?? "");
    if (!file) return;

    startTransition(async () => {
      try {
        const result = await previewIbkrCsv(await file.text());
        setPreview(result);
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not preview this CSV.",
        );
      }
    });
  }

  function confirmImport() {
    if (!preview || preview.toInsert.length === 0) return;

    startTransition(async () => {
      try {
        const result = await commitIbkrRows(preview.toInsert);
        setMessage(
          `${result.inserted} ${result.inserted === 1 ? "lot" : "lots"} imported.`,
        );
        setPreview({
          ...preview,
          duplicates: [...preview.duplicates, ...preview.toInsert],
          toInsert: [],
        });
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "The import did not finish.",
        );
      }
    });
  }

  return (
    <div className={styles.wizard}>
      <section className={styles.step}>
        <div className={styles.stepLabel}>
          <span>01</span>
          <div>
            <p className="eyebrow">Source file</p>
            <h2>Select an IBKR trades CSV</h2>
          </div>
        </div>
        <p className="form-note">
          Export your trades from Interactive Brokers. Your file stays on this
          computer.
        </p>
        <input
          ref={inputRef}
          className={styles.hiddenInput}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <button
          className={styles.filePicker}
          type="button"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          <span>{fileName || "No CSV selected"}</span>
          <strong>{isPending && !preview ? "Reading…" : "Choose CSV"}</strong>
        </button>
      </section>

      {preview && (
        <section className={styles.step}>
          <div className={styles.stepLabel}>
            <span>02</span>
            <div>
              <p className="eyebrow">Review</p>
              <h2>Trades ready to import</h2>
            </div>
          </div>

          <div className={styles.counts} aria-label="Import summary">
            <span>
              <strong>{preview.toInsert.length}</strong> ready
            </span>
            <span>
              <strong>{preview.duplicates.length}</strong> duplicates
            </span>
            <span>
              <strong>{preview.errors.length}</strong> skipped
            </span>
          </div>

          {preview.toInsert.length > 0 ? (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Date</th>
                    <th className={styles.numeric}>Quantity</th>
                    <th className={styles.numeric}>Cost / unit</th>
                    <th className={styles.numeric}>Fees</th>
                    <th>Trade ID</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.toInsert.map((row, index) => (
                    <tr key={`${row.externalTradeId ?? row.symbol}-${index}`}>
                      <td>
                        <strong>{row.symbol}</strong>
                      </td>
                      <td>{row.purchasedAt}</td>
                      <td className={styles.numeric}>{row.quantity}</td>
                      <td className={styles.numeric}>
                        {row.costPerUnit} {row.costCurrency}
                      </td>
                      <td className={styles.numeric}>
                        {row.fees} {row.costCurrency}
                      </td>
                      <td>{row.externalTradeId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>
              No new trades found in this file.
            </p>
          )}

          {preview.errors.length > 0 && (
            <details className={styles.errors}>
              <summary>{preview.errors.length} skipped rows</summary>
              <ul>
                {preview.errors.map((error, index) => (
                  <li key={`${error.line}-${index}`}>
                    Line {error.line}: {error.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <button
            className="primary-button"
            type="button"
            disabled={isPending || preview.toInsert.length === 0}
            onClick={confirmImport}
          >
            {isPending ? "Importing…" : "Import reviewed trades"}
          </button>
        </section>
      )}

      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}
    </div>
  );
}
