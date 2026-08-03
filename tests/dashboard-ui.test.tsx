import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { AppShell } from "@/components/AppShell";
import { HoldingsList } from "@/components/HoldingsList";
import { NetWorthHeader } from "@/components/NetWorthHeader";
import type { ValuedHolding } from "@/lib/domain/types";

const holding: ValuedHolding = {
  holding: {
    id: "holding-1",
    type: "equity",
    symbol: "VWCE",
    name: "Vanguard FTSE All-World",
    quoteCurrency: "EUR",
    manualValue: null,
    notes: null,
    updatedAt: "2026-07-25T10:00:00.000Z",
  },
  quantity: 4,
  avgCostPerUnit: 100,
  currentValueBase: 440,
  costBasisBase: 400,
  unrealizedPlBase: 40,
  unrealizedPlPct: 10,
};

describe("dashboard UI", () => {
  it("keeps Import in desktop navigation only", () => {
    const html = renderToStaticMarkup(
      <AppShell>
        <p>Dashboard</p>
      </AppShell>,
    );

    expect(html).toContain('aria-label="Desktop navigation"');
    expect(html).toContain('href="/import"');
    expect(html).toContain('aria-label="Mobile navigation"');

    const mobileNavigation = html.match(
      /<nav class="mobile-nav"[\s\S]*?<\/nav>/,
    )?.[0];
    expect(mobileNavigation).toContain('href="/"');
    expect(mobileNavigation).toContain('href="/settings"');
    expect(mobileNavigation).not.toContain('href="/import"');
  });

  it("renders portfolio total and signed gain", () => {
    const html = renderToStaticMarkup(
      <NetWorthHeader
        total={12450.2}
        profitLoss={325.45}
        currency="EUR"
        asOf="2026-07-25T10:00:00.000Z"
      />,
    );

    expect(html).toContain("€12,450.20");
    expect(html).toContain("+€325.45");
    expect(html).toContain("gain");
  });

  it("renders simple mobile holding information", () => {
    const html = renderToStaticMarkup(
      <HoldingsList holdings={[holding]} currency="EUR" />,
    );

    expect(html).toContain("VWCE");
    expect(html).toContain("€440.00");
    expect(html).toContain("+€40.00");
  });
});
