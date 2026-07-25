import Link from "next/link";
import type { ReactNode } from "react";

const desktopLinks = [
  { href: "/", label: "Home" },
  { href: "/holdings", label: "Holdings" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
];

const mobileLinks = [
  { href: "/", label: "Home" },
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
        <nav className="desktop-nav" aria-label="Desktop navigation">
          {desktopLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="sidebar-note">Private portfolio record</p>
      </aside>

      <header className="mobile-header">
        <Wordmark />
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {mobileLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="shell-content">{children}</div>
    </div>
  );
}
