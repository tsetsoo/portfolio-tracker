import { HoldingForm } from "@/components/HoldingForm";
import { HoldingsManager } from "@/components/HoldingsManager";
import { getDb } from "@/lib/db/client";
import { listHoldingsWithLots } from "@/lib/holdings-repo";
import { valuePortfolio } from "@/lib/portfolio/value-portfolio";

export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const db = getDb();
  const valuation = await valuePortfolio(db);
  const holdingsWithLots = listHoldingsWithLots(db);
  const lotsByHolding = Object.fromEntries(
    holdingsWithLots.map((holding) => [holding.id, holding.lots]),
  );

  return (
    <main className="dashboard management-page">
      <header className="page-header">
        <p className="eyebrow">Portfolio record</p>
        <h1>Holdings</h1>
        <p>Review each position and the lots that make up its cost basis.</p>
      </header>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Valued now</p>
            <h2>Current positions</h2>
          </div>
          <span>
            {valuation.holdings.length}{" "}
            {valuation.holdings.length === 1 ? "position" : "positions"}
          </span>
        </div>
        <HoldingsManager
          holdings={valuation.holdings}
          lotsByHolding={lotsByHolding}
          currency={valuation.baseCurrency}
        />
      </section>

      <section className="management-section">
        <div className="section-intro">
          <p className="eyebrow">New position</p>
          <h2>Add a holding</h2>
        </div>
        <HoldingForm />
      </section>
    </main>
  );
}
