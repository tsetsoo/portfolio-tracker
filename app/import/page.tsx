import { ImportWizard } from "@/components/ImportWizard";
import { PastImports } from "@/components/PastImports";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { getDb } from "@/lib/db/client";
import { listImportBatches } from "@/lib/import/batches";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  const batches = listImportBatches(getDb());

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow="Broker activity"
        title="Import trades"
        description="Upload Interactive Brokers, Binance, or Crypto.com CSVs, preview buys, skip duplicates, then commit lots in one transaction."
      />

      <ImportWizard />
      <PastImports batches={batches} />
    </Page>
  );
}
