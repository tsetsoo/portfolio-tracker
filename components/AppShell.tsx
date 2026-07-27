import Link from "next/link";
import type { ReactNode } from "react";

import { SidebarNav } from "@/components/SidebarNav";

const desktopLinks = [
  { href: "/", label: "Home" },
  { href: "/holdings", label: "Holdings" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
];

const mobileLinks = [
  { href: "/", label: "Home" },
  { href: "/holdings", label: "Holdings" },
  { href: "/settings", label: "Settings" },
];

function Wordmark() {
  return (
    <Link className="wordmark" href="/" aria-label="Ledger home">
      <span className="wordmark-mark" aria-hidden="true">
        PT
      </span>
      <span>
        Portfolio
        <strong>Ledger</strong>
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Wordmark />
        <SidebarNav
          className="desktop-nav"
          ariaLabel="Desktop navigation"
          links={desktopLinks}
        />
        <p className="sidebar-note">Private portfolio record</p>
      </aside>

      <header className="mobile-header">
        <Wordmark />
        <SidebarNav
          className="mobile-nav"
          ariaLabel="Mobile navigation"
          links={mobileLinks}
        />
      </header>

      <div className="shell-content">{children}</div>
    </div>
  );
}
