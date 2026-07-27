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
    title: "Select a Binance Spot Trade History CSV",
    hint: "Orders → Spot → Trade History → Export. Buys and sells are netted FIFO; fully sold coins are skipped.",
  },
  "auto-invest": {
    title: "Select a Binance Auto-Invest History CSV",
    hint: "Orders → Earn History → Auto-Invest → Export. Only Success rows become crypto lots (cost = amount ÷ units).",
  },
};

function brokerCopy(
  broker: Broker,
  binanceFormat: BinanceImportFormat,
): { title: string; hint: string; assetLabel: string } {
  if (broker === "ibkr") {
    return {
      title: "Select an IBKR trades CSV",
      hint: "Flex/Activity Trades CSV, or Client Portal Transaction History. Buys become equity lots; sells are skipped.",
      assetLabel: "Symbol",
    };
  }
  if (broker === "binance") {
    return { ...BINANCE_FORMAT_COPY[binanceFormat], assetLabel: "Asset" };
  }
  return {
    title: "Select a Crypto.com CSV",
    hint: "App: Accounts → History → Export, or Exchange trade history. Buys and crypto_exchange receives become crypto lots; sells/rewards are skipped.",
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

  function chooseFile(file: File | undefined) {
    setPreview(null);
    setMessage("");
    setFileName(file?.name ?? "");
    if (!file) return;

    startTransition(async () => {
      try {
        setPreview(
          await previewForBroker(broker, await file.text(), binanceFormat),
        );
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
            <span>
              <strong>{preview.errors.length}</strong> skipped
            </span>
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
