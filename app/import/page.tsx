import { ImportWizard } from "@/components/ImportWizard";
import { PastImports } from "@/components/PastImports";
import { getDb } from "@/lib/db/client";
import { listImportBatches } from "@/lib/import/batches";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  const batches = listImportBatches(getDb());

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
      <PastImports batches={batches} />
    </main>
  );
}
