export type ImportBroker = "ibkr" | "binance" | "cryptocom";

const BROKER_LABELS: Record<ImportBroker, string> = {
  ibkr: "Interactive Brokers",
  binance: "Binance",
  cryptocom: "Crypto.com",
};

export function suggestImportBatchName(
  broker: ImportBroker,
  date: Date = new Date(),
  sourceDetail?: string | null,
): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const stamp = `${yyyy}-${mm}-${dd}`;

  if (broker === "binance" && sourceDetail === "auto-invest") {
    return `Binance Auto-Invest ${stamp}`;
  }
  if (broker === "binance" && sourceDetail === "spot") {
    return `Binance Spot ${stamp}`;
  }
  return `${BROKER_LABELS[broker]} ${stamp}`;
}
