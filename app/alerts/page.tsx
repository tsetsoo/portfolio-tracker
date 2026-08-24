import { AlertsManager } from "@/components/AlertsManager";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { allowedAlertCurrencies } from "@/lib/alerts/currencies";
import { listAlerts } from "@/lib/alerts/repo";
import { telegramConfigFromEnv } from "@/lib/alerts/telegram";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const db = getDb();
  const alerts = listAlerts(db);
  const allowedCurrencies = allowedAlertCurrencies(db);

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow="Watchlist"
        title="Alerts"
        description="Price thresholds and percent moves, checked every 10 minutes and delivered by Telegram bot."
      />
      <div className="mt-5">
        <AlertsManager
          alerts={alerts}
          allowedCurrencies={allowedCurrencies}
          telegramConfigured={telegramConfigFromEnv() != null}
        />
      </div>
    </Page>
  );
}
