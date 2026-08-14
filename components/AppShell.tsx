import Link from "next/link";
import type { ReactNode } from "react";

import { SidebarNav } from "@/components/SidebarNav";
import {
  HomeIcon,
  ImportIcon,
  LayersIcon,
  SettingsIcon,
  WalletIcon,
} from "@/components/ui/icons";

const links = [
  { href: "/", label: "Home", icon: <HomeIcon /> },
  { href: "/holdings", label: "Holdings", icon: <LayersIcon /> },
  { href: "/wallets", label: "Wallets", icon: <WalletIcon /> },
  { href: "/import", label: "Import", icon: <ImportIcon /> },
  { href: "/settings", label: "Settings", icon: <SettingsIcon /> },
];

// Anchor styling is delegated through the nav's className so SidebarNav's own
// markup stays untouched.
const SIDEBAR_NAV =
  "mt-10 grid gap-0.5 " +
  "[&>a]:flex [&>a]:items-center [&>a]:gap-3 [&>a]:rounded-lg [&>a]:border-l-2 [&>a]:border-transparent " +
  "[&>a]:px-3 [&>a]:py-2.5 [&>a]:text-[13px] [&>a]:text-dim [&>a]:transition-colors [&>a]:duration-150 " +
  "[&>a:hover]:bg-elevated [&>a:hover]:text-text " +
  "[&>a[aria-current=page]]:border-white [&>a[aria-current=page]]:bg-elevated [&>a[aria-current=page]]:text-text " +
  "[&>a:focus-visible]:outline [&>a:focus-visible]:outline-2 [&>a:focus-visible]:outline-offset-2 [&>a:focus-visible]:outline-white/70 " +
  "[&[data-pending=true]>a]:opacity-50";

const TAB_NAV =
  "grid grid-cols-5 " +
  "[&>a]:flex [&>a]:flex-col [&>a]:items-center [&>a]:gap-1 [&>a]:py-2.5 " +
  "[&>a]:text-[10px] [&>a]:font-medium [&>a]:text-faint [&>a]:transition-colors [&>a]:duration-150 " +
  "[&>a[aria-current=page]]:text-text " +
  "[&>a:focus-visible]:outline [&>a:focus-visible]:outline-2 [&>a:focus-visible]:-outline-offset-2 [&>a:focus-visible]:outline-white/70 " +
  "[&[data-pending=true]>a]:opacity-50";

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
      href="/"
      aria-label="Portfolio Ledger home"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-8 items-center justify-center rounded-lg border border-line-strong bg-elevated font-mono text-[10px] tracking-[0.1em] text-dim"
      >
        PT
      </span>
      {!compact && (
        <span className="text-[11px] leading-tight text-dim">
          Portfolio
          <strong className="block text-[15px] font-semibold text-text">
            Ledger
          </strong>
        </span>
      )}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface px-5 py-7 lg:flex">
        <Wordmark />
        <SidebarNav
          className={SIDEBAR_NAV}
          ariaLabel="Main navigation"
          links={links}
        />
        <p className="mt-auto border-t border-line pt-4 text-[10px] text-faint">
          Private portfolio record
        </p>
      </aside>

      <header className="sticky top-0 z-40 flex h-14 items-center border-b border-line bg-surface/85 px-4 backdrop-blur-md lg:hidden">
        <Wordmark />
      </header>

      <div className="min-w-0">{children}</div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <SidebarNav
          className={TAB_NAV}
          ariaLabel="Mobile navigation"
          links={links}
        />
      </div>
    </div>
  );
}
