import { ResetPortfolioForm } from "@/components/ResetPortfolioForm";
import { SettingsForm } from "@/components/SettingsForm";
import { Card } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getDb } from "@/lib/db/client";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const settings = getSettings(getDb());

  return (
    <Page width="slim">
      <PageHeader
        eyebrow="Display rules"
        title="Settings"
        description="Choose how values across your portfolio are reported."
      />

      <Card className="mt-6">
        <SectionHeading
          eyebrow="Reporting"
          title="Portfolio currency"
          meta={settings.baseCurrency}
        />
        <SettingsForm baseCurrency={settings.baseCurrency} />
      </Card>

      <div className="mt-4">
        <ResetPortfolioForm />
      </div>
    </Page>
  );
}
