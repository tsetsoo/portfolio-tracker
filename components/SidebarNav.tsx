"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

export type NavLink = {
  href: string;
  label: string;
};

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({
  links,
  className,
  ariaLabel,
}: {
  links: NavLink[];
  className: string;
  ariaLabel: string;
}) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <nav
      className={className}
      aria-label={ariaLabel}
      aria-busy={isPending || undefined}
      data-pending={isPending ? "true" : undefined}
    >
      {links.map((link) => {
        const active = isActivePath(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            prefetch
            scroll
            aria-current={active ? "page" : undefined}
            onClick={(event) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }
              // Force a reliable App Router transition; soft nav was intermittently no-op.
              event.preventDefault();
              startTransition(() => {
                router.push(link.href);
              });
            }}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
