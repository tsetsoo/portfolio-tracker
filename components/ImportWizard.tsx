"use client";

import { useRef, useState, useTransition } from "react";

import {
  commitBinanceRows,
  commitCryptoComRows,
  commitIbkrRows,
  previewBinanceCsv,
  previewCryptoComCsv,
  previewIbkrCsv,
} from "@/app/actions/import";
import type {
  BinanceImportFormat,
  BinanceImportPreview,
} from "@/lib/binance/commit";
import type { CryptoComImportPreview } from "@/lib/cryptocom/commit";
import type { IbkrImportPreview } from "@/lib/ibkr/commit";
import { combineCsvTexts } from "@/lib/import/combine-csv";
import { summarizeImportNotes } from "@/lib/import/notes";

import styles from "./ImportWizard.module.css";

type Broker = "ibkr" | "binance" | "cryptocom";

type Preview =
  | IbkrImportPreview
  | BinanceImportPreview
  | CryptoComImportPreview;

const BROKER_LABELS: Record<Broker, string> = {
  ibkr: "Interactive Brokers",
  binance: "Binance",
  cryptocom: "Crypto.com",
};

const BINANCE_FORMAT_COPY: Record<
  BinanceImportFormat,
  { title: string; hint: string }
> = {
  spot: {
    title: "Select Binance Spot Trade History CSV(s)",
    hint: "Orders → Spot → Trade History → Export. Select multiple date-range exports to net sells correctly (FIFO). Deposits/transfers are not in Spot history — import Spot buys for coins acquired on Binance; Crypto.com withdrawals should already zero the source side.",
  },
  "auto-invest": {
    title: "Select Binance Auto-Invest History CSV(s)",
    hint: "Orders → Earn History → Auto-Invest → Export. Only Success rows become crypto lots (cost = amount ÷ units). Multiple files are combined. This does not import deposits from other exchanges.",
  },
};

function brokerCopy(
  broker: Broker,
  binanceFormat: BinanceImportFormat,
): { title: string; hint: string; assetLabel: string } {
  if (broker === "ibkr") {
    return {
      title: "Select IBKR trades CSV(s)",
      hint: "Flex/Activity Trades CSV, or Client Portal Transaction History. Select multiple exports if needed; buys become equity lots, sells are skipped.",
      assetLabel: "Symbol",
    };
  }
  if (broker === "binance") {
    return { ...BINANCE_FORMAT_COPY[binanceFormat], assetLabel: "Asset" };
  }
  return {
    title: "Select Crypto.com CSV(s)",
    hint: "App: Accounts → History → Export. Select all date-range CSVs together so withdrawals/swaps FIFO-net against buys. Rewards/cashback are skipped; withdrawals and wallet swaps reduce open lots (transfer out of CDC). Import Binance Spot buys separately for coins that continue there — do not expect deposit rows.",
    assetLabel: "Asset",
  };
}

async function previewForBroker(
  broker: Broker,
  text: string,
  binanceFormat: BinanceImportFormat,
): Promise<Preview> {
  switch (broker) {
    case "ibkr":
      return previewIbkrCsv(text);
    case "binance":
      return previewBinanceCsv(text, binanceFormat);
    case "cryptocom":
      return previewCryptoComCsv(text);
  }
}

async function commitForBroker(
  broker: Broker,
  rows: Preview["toInsert"],
): Promise<{ inserted: number }> {
  switch (broker) {
    case "ibkr":
      return commitIbkrRows(rows as never);
    case "binance":
      return commitBinanceRows(rows as never);
    case "cryptocom":
      return commitCryptoComRows(rows as never);
  }
}

export function ImportWizard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [broker, setBroker] = useState<Broker>("ibkr");
  const [binanceFormat, setBinanceFormat] =
    useState<BinanceImportFormat>("spot");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const copy = brokerCopy(broker, binanceFormat);
  const noteSummary = preview ? summarizeImportNotes(preview.errors) : null;

  function resetFile() {
    setPreview(null);
    setMessage("");
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function selectBroker(next: Broker) {
    if (next === broker) return;
    setBroker(next);
    resetFile();
  }

  function selectBinanceFormat(next: BinanceImportFormat) {
    if (next === binanceFormat) return;
    setBinanceFormat(next);
    resetFile();
  }

  function fileLabel(files: File[]): string {
    if (files.length === 0) return "";
    if (files.length === 1) return files[0]!.name;
    return `${files.length} files combined`;
  }

  function chooseFiles(fileList: FileList | null) {
    setPreview(null);
    setMessage("");
    const files = fileList ? Array.from(fileList) : [];
    setFileName(fileLabel(files));
    if (files.length === 0) return;

    startTransition(async () => {
      try {
        const texts = await Promise.all(files.map((file) => file.text()));
        const combined = combineCsvTexts(texts);
        setPreview(await previewForBroker(broker, combined, binanceFormat));
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
        const result = await commitForBroker(broker, preview.toInsert);
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
            <p className="eyebrow">Broker</p>
            <h2>Choose import source</h2>
          </div>
        </div>
        <div className={styles.brokerTabs} role="tablist" aria-label="Broker">
          {(Object.keys(BROKER_LABELS) as Broker[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={broker === key}
              className={
                broker === key ? styles.brokerTabActive : styles.brokerTab
              }
              onClick={() => selectBroker(key)}
            >
              {BROKER_LABELS[key]}
            </button>
          ))}
        </div>
        {broker === "binance" && (
          <div
            className={styles.formatTabs}
            role="tablist"
            aria-label="Binance export type"
          >
            <button
              type="button"
              role="tab"
              aria-selected={binanceFormat === "spot"}
              className={
                binanceFormat === "spot"
                  ? styles.formatTabActive
                  : styles.formatTab
              }
              onClick={() => selectBinanceFormat("spot")}
            >
              Spot Trade History
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={binanceFormat === "auto-invest"}
              className={
                binanceFormat === "auto-invest"
                  ? styles.formatTabActive
                  : styles.formatTab
              }
              onClick={() => selectBinanceFormat("auto-invest")}
            >
              Auto-Invest History
            </button>
          </div>
        )}
      </section>

      <section className={styles.step}>
        <div className={styles.stepLabel}>
          <span>02</span>
          <div>
            <p className="eyebrow">Source file</p>
            <h2>{copy.title}</h2>
          </div>
        </div>
        <p className="form-note">{copy.hint}</p>
        <input
          ref={inputRef}
          className={styles.hiddenInput}
          type="file"
          accept=".csv,text/csv"
          multiple
          onChange={(event) => chooseFiles(event.target.files)}
        />
        <button
          className={styles.filePicker}
          type="button"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          <span>{fileName || "No CSV selected"}</span>
          <strong>
            {isPending && !preview ? "Reading…" : "Choose CSV(s)"}
          </strong>
        </button>
      </section>

      {preview && (
        <section className={styles.step}>
          <div className={styles.stepLabel}>
            <span>03</span>
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
            {noteSummary && (
              <>
                <span>
                  <strong>{noteSummary.netted}</strong> netted
                </span>
                <span>
                  <strong>{noteSummary.closed}</strong> closed
                </span>
                <span>
                  <strong>{noteSummary.skipped}</strong> skipped
                </span>
                <span>
                  <strong>{noteSummary.warnings + noteSummary.other}</strong>{" "}
                  warnings
                </span>
              </>
            )}
          </div>

          {preview.toInsert.length > 0 ? (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{copy.assetLabel}</th>
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
            <p className={styles.empty}>No new trades found in this file.</p>
          )}

          {preview.errors.length > 0 && noteSummary && (
            <details className={styles.errors}>
              <summary>
                {preview.errors.length} notes ({noteSummary.netted} netted,{" "}
                {noteSummary.closed} closed, {noteSummary.skipped} skipped,{" "}
                {noteSummary.warnings + noteSummary.other} warnings)
              </summary>
              <p className={styles.noteLegend}>
                Netted = sells/withdrawals applied to open lots. Closed =
                position fully exited. Skipped = rewards/cashback ignored.
                Warnings = sell exceeded inventory or invalid rows.
              </p>
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
