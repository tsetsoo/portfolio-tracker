import { ImportWizard } from "@/components/ImportWizard";

export default function ImportPage() {
  return (
    <main className="dashboard management-page import-page">
      <header className="page-header">
        <p className="eyebrow">Broker activity</p>
        <h1>Import trades</h1>
        <p>
          Upload Interactive Brokers, Binance, or Crypto.com CSVs, preview
          buys, skip duplicates, then commit lots in one transaction.
        </p>
      </header>

      <ImportWizard />
    </main>
  );
}
