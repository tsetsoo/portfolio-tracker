import { ImportWizard } from "@/components/ImportWizard";

export default function ImportPage() {
  return (
    <main className="dashboard management-page import-page">
      <header className="page-header">
        <p className="eyebrow">Broker activity</p>
        <h1>Import trades</h1>
        <p>
          Preview an Interactive Brokers CSV, remove trades already recorded,
          then add the new lots in one transaction.
        </p>
      </header>

      <ImportWizard />
    </main>
  );
}
