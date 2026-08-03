import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/portfolio", () => ({
  loadDashboardData: vi.fn(() => new Promise(() => {})),
  loadHoldingsData: vi.fn(() => new Promise(() => {})),
  forceRefreshPortfolio: vi.fn(),
}));

import { DashboardClient } from "@/components/DashboardClient";
import { HoldingsPageClient } from "@/components/HoldingsPageClient";

describe("client page shells", () => {
  it("renders dashboard chrome before data arrives", () => {
    const html = renderToStaticMarkup(<DashboardClient />);
    expect(html).toContain("Overview");
    expect(html).toContain("Loading portfolio");
    expect(html).toContain("Refresh prices");
  });

  it("renders holdings chrome before data arrives", () => {
    const html = renderToStaticMarkup(<HoldingsPageClient />);
    expect(html).toContain("Holdings");
    expect(html).toContain("Loading holdings");
    expect(html).toContain("Add a holding");
  });
});
