# Dark UI Redesign Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the light "paper & ink" stylesheet with a dark fintech interface built on Tailwind CSS v4, across all five pages.

**Architecture:** Tailwind v4 is configured in CSS, so `app/globals.css` becomes `@import "tailwindcss"` plus an `@theme` block holding every design token. The 1203-line hand-written stylesheet is deleted and each component's `className` is rewritten against utilities. Repeated chrome lives in six presentational primitives under `components/ui/`.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS v4, `@tailwindcss/postcss`, `next/font/google` (Geist, Geist Mono), Recharts 3, Vitest.

## Global Constraints

- Dark theme only. No light mode, no theme toggle, no `prefers-color-scheme` blocks.
- Chrome is monochrome. `--color-gain`, `--color-loss`, and `--color-warn` appear only on P&L figures, the chart, and the stale-price banner — never on buttons, nav, or focus rings.
- No changes to server actions, database access, pricing, or valuation logic. This is a presentation-layer change only.
- `SidebarNav` keeps its `{ links, className, ariaLabel }` prop signature — `tests/sidebar-nav.test.tsx` constructs it that way.
- Every monetary value, quantity, and percentage renders in Geist Mono with `tabular-nums`.
- Every interactive element keeps a visible focus ring: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70`.
- No horizontal scroll on `body`. Wide tables scroll inside their own `overflow-x-auto` container.
- Tailwind v4 only — do not create a `tailwind.config.js`.

---

### Task 1: Tailwind v4 foundation, tokens, and fonts

**Files:**
- Create: `postcss.config.mjs`
- Rewrite: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `package.json`

**Produces:** the `@theme` token names every later task consumes — `base`, `surface`, `elevated`, `line`, `line-strong`, `text`, `dim`, `faint`, `gain`, `loss`, `warn`; font variables `--font-sans`, `--font-mono`.

- [ ] **Step 1: Install Tailwind v4**

```bash
npm install -D tailwindcss@^4 @tailwindcss/postcss
```

- [ ] **Step 2: Create `postcss.config.mjs`**

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 3: Rewrite `app/globals.css`**

Delete all 1203 existing lines. Replace with the import, the `@theme` token block, and a short base layer:

```css
@import "tailwindcss";

@theme {
  --color-base: #0a0e14;
  --color-surface: #111823;
  --color-elevated: #18202c;
  --color-line: rgba(255, 255, 255, 0.07);
  --color-line-strong: rgba(255, 255, 255, 0.14);
  --color-text: #e6edf5;
  --color-dim: #8494a6;
  --color-faint: #5a6878;
  --color-gain: #3fdd8a;
  --color-loss: #ff6b6b;
  --color-warn: #f5b54a;

  --radius-card: 14px;

  --shadow-card: inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px -12px rgba(0, 0, 0, 0.6);

  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
}

@layer base {
  html,
  body {
    max-width: 100vw;
    overflow-x: hidden;
  }

  body {
    background: var(--color-base);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  a {
    color: inherit;
    text-decoration: none;
  }
}

@utility tnum {
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: Load fonts in `app/layout.tsx`**

```tsx
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
```

Apply both variables plus `bg-base text-text` on `<html>`, and keep `<AppShell>` wrapping `children`.

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: succeeds. Pages will look unstyled and dark — every component still carries the now-meaningless old class names. That is expected at this stage.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json postcss.config.mjs app/globals.css app/layout.tsx
git commit -m "feat: tailwind v4 foundation with dark token system"
```

---

### Task 2: Shared UI primitives

**Files:**
- Create: `components/ui/Card.tsx`, `components/ui/SectionHeading.tsx`, `components/ui/StatTile.tsx`, `components/ui/Button.tsx`, `components/ui/Field.tsx`, `components/ui/DataTable.tsx`

**Consumes:** tokens from Task 1.

**Produces:** the exact prop signatures every later task imports.

```tsx
Card({ children, className }: { children: ReactNode; className?: string })
SectionHeading({ eyebrow, title, meta }: { eyebrow?: string; title: string; meta?: ReactNode })
StatTile({ label, value, share, delta }: { label: string; value: string; share?: number; delta?: { text: string; direction: "gain" | "loss" | "neutral" } })
Button({ variant, ...props }: { variant?: "primary" | "secondary" | "danger" | "ghost" } & ButtonHTMLAttributes<HTMLButtonElement>)
Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode })
DataTable({ head, children }: { head: ReactNode; children: ReactNode })
```

- [ ] **Step 1: Write `Card.tsx`**

```tsx
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[--radius-card] border border-line bg-surface shadow-[--shadow-card] ${className}`}
    >
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Write `SectionHeading.tsx`** — eyebrow in 10px uppercase `text-faint` tracking `0.14em`, title 16px semibold, `meta` slot right-aligned in mono `text-faint`, separated by `border-b border-line`, padding `px-5 py-4`.

- [ ] **Step 3: Write `StatTile.tsx`** — label in eyebrow style, value in `font-mono tnum text-2xl`, optional delta pill (`rounded-full px-2 py-0.5 text-xs` tinted by direction), optional share bar (`h-1 rounded-full bg-elevated` track with a `bg-text/40` fill at `share * 100%`).

- [ ] **Step 4: Write `Button.tsx`** — shared base `inline-flex items-center gap-2 rounded-lg px-3 min-h-9 text-xs font-semibold transition-colors duration-150` plus the focus ring from Global Constraints. Variants: `primary` = `bg-text text-base hover:bg-white`; `secondary` = `border border-line bg-elevated text-text hover:border-line-strong`; `danger` = `border border-loss/40 text-loss hover:bg-loss hover:text-base`; `ghost` = `text-dim hover:text-text`. Include `disabled:opacity-45 disabled:cursor-not-allowed`.

- [ ] **Step 5: Write `Field.tsx`** — label in eyebrow style, input styling applied via a wrapper class so `<input>`/`<select>` children inherit it: `bg-elevated border border-line rounded-lg min-h-10 px-3 font-mono text-[13px] text-text placeholder:text-faint` plus focus ring.

- [ ] **Step 6: Write `DataTable.tsx`** — `overflow-x-auto` wrapper, `<table class="w-full border-collapse text-xs">`, `<thead>` on `bg-elevated` with 9px uppercase `text-faint` cells.

- [ ] **Step 7: Verify**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add components/ui
git commit -m "feat: shared dark-theme UI primitives"
```

---

### Task 3: App shell and navigation

**Files:**
- Modify: `components/AppShell.tsx`, `components/SidebarNav.tsx`
- Test: `tests/sidebar-nav.test.tsx` (must keep passing unmodified)

**Consumes:** `Card` tokens from Task 1.

- [ ] **Step 1: Rewrite `AppShell.tsx`** — desktop grid `lg:grid-cols-[240px_minmax(0,1fr)]`; sidebar `bg-surface border-r border-line sticky top-0 h-screen p-6 hidden lg:flex flex-col`; wordmark mark becomes a `rounded-lg border border-line-strong bg-elevated` square; footer note in `text-faint text-[10px]`. Mobile header keeps only the wordmark. Add a fixed bottom tab bar for mobile carrying all five destinations, and `pb-24 lg:pb-0` on the content wrapper so it clears the bar.

- [ ] **Step 2: Rewrite `SidebarNav.tsx` styling** — keep the component's logic and `{ links, className, ariaLabel }` signature exactly as-is. Style active items via `aria-current`: `[&[aria-current=page]]:bg-elevated [&[aria-current=page]]:text-text` with a white left bar; inactive `text-dim hover:text-text`. Keep `data-pending` dimming.

- [ ] **Step 3: Run the nav test**

Run: `npx vitest run tests/sidebar-nav.test.tsx`
Expected: PASS, unmodified.

- [ ] **Step 4: Commit**

```bash
git add components/AppShell.tsx components/SidebarNav.tsx
git commit -m "feat: dark app shell with mobile tab bar"
```

---

### Task 4: Home — hero, stat tiles, banner

**Files:**
- Modify: `components/NetWorthHeader.tsx`, `components/OutdatedBanner.tsx`, `components/DashboardClient.tsx`

**Consumes:** `Card`, `SectionHeading`, `StatTile`, `Button` from Task 2.

- [ ] **Step 1: Rewrite `NetWorthHeader.tsx`** as a hero `Card`: eyebrow "Total portfolio", total in `font-mono tnum text-[clamp(38px,9vw,64px)] tracking-[-0.04em]`, valuation timestamp in `text-faint text-[11px]`, and the P&L as a delta pill (`▲`/`▼` + signed money + percent) tinted by direction. Drop the `formatMoney` re-export.

- [ ] **Step 2: Point the three consumers at `lib/format-money`** — `HoldingsTable.tsx`, `HoldingsList.tsx`, `HoldingsManager.tsx` currently import from `./NetWorthHeader`.

- [ ] **Step 3: Rewrite `OutdatedBanner.tsx`** — `rounded-[--radius-card] border border-warn/25 bg-warn/8 text-warn` row with an inline icon.

- [ ] **Step 4: Add the stat tile row to `DashboardClient.tsx`**

Compute from data already in `data.valuation.holdings` — no new queries:

```tsx
const totals = SECTIONS.map((section) => {
  const items = data.valuation.holdings.filter((h) => h.holding.type === section.type);
  const value = items.reduce((sum, h) => sum + h.currentValueBase, 0);
  return { label: section.title, value, share: data.valuation.totalBase > 0 ? value / data.valuation.totalBase : 0 };
}).filter((t) => t.value > 0);
```

Render as `grid gap-3 sm:grid-cols-3` of `StatTile`. Restyle the toolbar and refresh `Button`, and replace `.page-loading` / `.page-load-error` with dark equivalents.

- [ ] **Step 5: Verify**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add components/NetWorthHeader.tsx components/OutdatedBanner.tsx components/DashboardClient.tsx components/HoldingsTable.tsx components/HoldingsList.tsx components/HoldingsManager.tsx
git commit -m "feat: dark net worth hero and asset class stat tiles"
```

---

### Task 5: History chart

**Files:**
- Modify: `components/HistoryChart.tsx`

- [ ] **Step 1: Restyle the Recharts area** — gradient `--color-gain` at `stopOpacity 0.22` → `0`, stroke `#3fdd8a` at 2px, axis ticks `fill: "#8494a6", fontSize: 11`, `YAxis` stays hidden.

- [ ] **Step 2: Replace the default tooltip** with a custom dark card

```tsx
<Tooltip
  cursor={{ stroke: "rgba(255,255,255,0.18)", strokeWidth: 1 }}
  content={({ active, payload, label }) =>
    active && payload?.length ? (
      <div className="rounded-lg border border-line-strong bg-elevated px-3 py-2 shadow-lg">
        <p className="text-[10px] uppercase tracking-[0.14em] text-faint">
          {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
            new Date(`${String(label)}T00:00:00`),
          )}
        </p>
        <p className="font-mono tnum text-sm text-text">
          {compactMoney(Number(payload[0].value), currency)}
        </p>
      </div>
    ) : null
  }
/>
```

- [ ] **Step 3: Restyle the empty state** — centred `text-dim`, dashed `border-line` circle.

- [ ] **Step 4: Commit**

```bash
git add components/HistoryChart.tsx
git commit -m "feat: dark history chart with custom tooltip"
```

---

### Task 6: Holdings tables and lists

**Files:**
- Modify: `components/HoldingsTable.tsx`, `components/HoldingsList.tsx`

**Consumes:** `DataTable` from Task 2.

- [ ] **Step 1: Rewrite `HoldingsTable.tsx`** using `DataTable`. Header cells 9px uppercase `text-faint`; body rows `border-t border-line hover:bg-elevated transition-colors`; symbol in `font-mono text-xs font-semibold`, name beneath in `text-[10px] text-dim truncate max-w-[220px]`; all numeric cells `text-right font-mono tnum whitespace-nowrap`; P&L tinted with the percentage beneath at `text-[9px]`.

- [ ] **Step 2: Add the share-of-portfolio micro-bar** — accept an optional `totalBase?: number` prop; when present render a 2px `bg-text/25` bar under the value cell at `currentValueBase / totalBase`. Pass `data.valuation.totalBase` from `DashboardClient`.

- [ ] **Step 3: Rewrite `HoldingsList.tsx`** (mobile) — rows as `flex items-center justify-between border-b border-line px-4 py-3.5`, value in mono, P&L tinted.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add components/HoldingsTable.tsx components/HoldingsList.tsx components/DashboardClient.tsx
git commit -m "feat: dark holdings table and mobile list"
```

---

### Task 7: Holdings page

**Files:**
- Modify: `components/HoldingsPageClient.tsx`, `components/HoldingsManager.tsx`, `components/HoldingForm.tsx`

**Consumes:** `Card`, `SectionHeading`, `Button`, `Field`, `DataTable`.

- [ ] **Step 1: Restyle the page header** — shared pattern for all four inner pages: eyebrow, `h1` in `font-mono tnum text-[clamp(32px,7vw,44px)] tracking-[-0.04em]`, description in `text-dim text-xs max-w-lg`, `border-b border-line pb-6`.

- [ ] **Step 2: Rewrite `HoldingsManager.tsx`** — one `Card` per asset class with `SectionHeading`; each position a row with `border-b border-line`; the manual-value form and delete action on an inset `bg-base/40 border-t border-line` strip using `Field` and `Button`.

- [ ] **Step 3: Restyle the lots disclosure** — keep the `<details>` element and its summary/chevron structure. Summary `px-5 py-3 text-[11px] font-semibold hover:bg-elevated`; chevron rotates via `[[open]_&]:rotate-[225deg]`; open panel `bg-base` with the lots table in `DataTable`.

- [ ] **Step 4: Rewrite `HoldingForm.tsx`** — form inside a `Card`, inputs via `Field`, submit as `Button variant="primary"`.

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add components/HoldingsPageClient.tsx components/HoldingsManager.tsx components/HoldingForm.tsx
git commit -m "feat: dark holdings management page"
```

---

### Task 8: Wallets page

**Files:**
- Modify: `components/WalletsManager.tsx` (764 lines), `app/wallets/page.tsx`

- [ ] **Step 1: Restyle only — change no behaviour.** This is the largest component and its logic is load-bearing. Work through it converting class names: toolbar to a `flex flex-wrap gap-2` row of `Button`s; the add-wallet and xpub forms to `Field` grids inside a `rounded-lg border border-line bg-elevated/40 p-4` panel; wallet rows to `Card`s; addresses in `font-mono text-[11px] text-dim break-all`.

- [ ] **Step 2: Apply the token colors to status figures** — cost-coverage and mismatch counts use `text-gain` / `text-warn` / `text-loss` by threshold, matching the existing logic's intent.

- [ ] **Step 3: Restyle `app/wallets/page.tsx`** header and section note with the Task 7 Step 1 page-header pattern.

- [ ] **Step 4: Verify**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add components/WalletsManager.tsx app/wallets/page.tsx
git commit -m "feat: dark wallets page"
```

---

### Task 9: Import page

**Files:**
- Modify: `components/ImportWizard.tsx`, `components/ImportWizard.module.css`, `components/PastImports.tsx`, `app/import/page.tsx`

- [ ] **Step 1: Rewrite `ImportWizard.module.css` against the tokens.** Keep the file and its local class names — it is already scoped, so it does not collide with anything. Swap every color literal for `var(--color-*)`, add `border-radius` and the card shadow to panel rules, and restyle the drop zone as a dashed `--color-line-strong` border on `--color-elevated` that brightens on drag-over.

- [ ] **Step 2: Restyle `ImportWizard.tsx`** — step markers as numbered circles, active filled `bg-text text-base`, completed `border-gain text-gain`, pending `border-line text-faint`. Buttons become the `Button` primitive.

- [ ] **Step 3: Rewrite `PastImports.tsx`** — each batch a `Card` row; filenames in `font-mono text-[11px] text-dim`; rename input via `Field`; actions via `Button`.

- [ ] **Step 4: Restyle `app/import/page.tsx`** header with the page-header pattern.

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add components/ImportWizard.tsx components/ImportWizard.module.css components/PastImports.tsx app/import/page.tsx
git commit -m "feat: dark import wizard"
```

---

### Task 10: Settings page

**Files:**
- Modify: `components/SettingsForm.tsx`, `components/ResetPortfolioForm.tsx`, `app/settings/page.tsx`

- [ ] **Step 1: Rewrite `SettingsForm.tsx`** — currency input via `Field` capped at `max-w-32`, save as `Button variant="primary"`, helper copy in `text-dim text-[11px]`.

- [ ] **Step 2: Rewrite `ResetPortfolioForm.tsx`** — inside a card bordered `border-loss/25` on `bg-loss/5`; the confirm input via `Field`; the action as `Button variant="danger"`, keeping the existing disabled-until-confirmed logic untouched.

- [ ] **Step 3: Restyle `app/settings/page.tsx`** header with the page-header pattern.

- [ ] **Step 4: Commit**

```bash
git add components/SettingsForm.tsx components/ResetPortfolioForm.tsx app/settings/page.tsx
git commit -m "feat: dark settings page"
```

---

### Task 11: Full verification sweep

**Files:** any needing repair from the checks below.

- [ ] **Step 1: Confirm no orphaned class names remain**

```bash
grep -rnE "className=\"[^\"]*(dashboard-panel|section-heading|holdings-table|net-worth-header|managed-holding|page-header|eyebrow|primary-button|secondary-button|danger-button|asset-form|settings-form|wallet-add|past-import)" app components
```

Expected: no matches outside `ImportWizard.module.css` consumers.

- [ ] **Step 2: Run the full suite**

```bash
npm run lint && npm test && npm run build
```

Expected: all three pass.

- [ ] **Step 3: Screenshot every page at both widths**

Start `npm run dev`, then capture `/`, `/holdings`, `/wallets`, `/import`, `/settings` at 390px and 1440px. Confirm: no light-mode remnants, no horizontal body scroll, focus rings visible on tab, bottom tab bar clearing content on mobile, and numeric columns aligned.

- [ ] **Step 4: Commit any repairs**

```bash
git add -A
git commit -m "fix: dark redesign verification repairs"
```

---

## Self-Review

**Spec coverage:** palette and typography → Task 1; depth and motion → Tasks 1–2; primitives → Task 2; shell and mobile nav → Task 3; Home hero, stat tiles, chart, tables → Tasks 4–6; Holdings → Task 7; Wallets → Task 8; Import → Task 9; Settings → Task 10; table treatment → Tasks 2, 6, 7; `formatMoney` fix → Task 4 Step 2; verification → Task 11. No gaps.

**Placeholders:** none — every step names exact files, classes, or commands.

**Type consistency:** `Card`, `SectionHeading`, `StatTile`, `Button`, `Field`, `DataTable` signatures are fixed in Task 2 and used with those exact names and props in Tasks 3–10. Token names in `@theme` (Task 1) match every `bg-`/`text-`/`border-` utility used later.

**Deviation from TDD:** this plan is presentation-only. The existing suite covers behaviour, which must not change, so verification is `lint` + `test` + `build` + visual inspection at each task rather than new failing tests. `tests/sidebar-nav.test.tsx` is the one behavioural guard touching redesigned code and is run explicitly in Task 3.
