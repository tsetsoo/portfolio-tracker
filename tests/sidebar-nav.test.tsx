import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/holdings",
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
import { SidebarNav } from "@/components/SidebarNav";

describe("SidebarNav", () => {
  it("marks the current route with aria-current", () => {
    const html = renderToStaticMarkup(
      <SidebarNav
        className="desktop-nav"
        ariaLabel="Desktop navigation"
        links={[
          { href: "/", label: "Home" },
          { href: "/holdings", label: "Holdings" },
          { href: "/settings", label: "Settings" },
        ]}
      />,
    );

    expect(html).toContain('href="/holdings" aria-current="page"');
    expect(html).not.toContain('href="/" aria-current="page"');
  });
});

describe("AppShell navigation", () => {
  it("links to the alerts page in both navs", () => {
    const html = renderToStaticMarkup(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    expect(html).toContain('href="/alerts"');
    expect(html.match(/href="\/alerts"/g)).toHaveLength(2);
    expect(html).toContain("Alerts");
    expect(html).toContain("grid-cols-6");
  });
});
