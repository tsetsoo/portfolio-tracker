import { ResetPortfolioForm } from "@/components/ResetPortfolioForm";
import { SettingsForm } from "@/components/SettingsForm";
import { getDb } from "@/lib/db/client";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const settings = getSettings(getDb());

  return (
    <main className="dashboard management-page settings-page">
      <header className="page-header">
        <p className="eyebrow">Display rules</p>
        <h1>Settings</h1>
        <p>Choose how values across your portfolio are reported.</p>
      </header>

      <section className="dashboard-panel settings-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Reporting</p>
            <h2>Portfolio currency</h2>
          </div>
          <span>{settings.baseCurrency}</span>
        </div>
        <SettingsForm baseCurrency={settings.baseCurrency} />
      </section>

      <section className="dashboard-panel settings-panel reset-panel">
        <ResetPortfolioForm />
      </section>
    </main>
  );
}
