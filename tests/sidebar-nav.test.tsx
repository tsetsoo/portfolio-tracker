import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/holdings",
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
