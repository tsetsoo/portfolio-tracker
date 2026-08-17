# Dark UI Redesign

Date: 2026-08-13

> **Superseded in part — see "Amendments" at the end.** This document specifies
> Tailwind **v4**; the implementation shipped on **v3** because v4 cannot
> cross-build for the Raspberry Pi. Everything else here was built as written.

## Goal

Replace the current light "paper & ink" editorial styling with a modern dark
fintech interface across every page, implemented in Tailwind CSS v4.

## Decisions

| Question | Decision |
| --- | --- |
| Visual direction | Modern dark fintech: dark surfaces, rounded cards, soft depth |
| Scope | All five pages redesigned in depth |
| CSS stack | Tailwind v4, replacing the hand-written stylesheet |
| Color character | Restrained. Chrome is monochrome; hue carries data only |
| Themes | Dark only. No light mode, no theme toggle |

## Design language

### Palette

Defined once in the Tailwind v4 `@theme` block. Chrome uses no hue: buttons,
active navigation, and focus rings are white or grey. Green and red appear only
on profit-and-loss figures and the history chart, so the numbers are the
loudest thing on screen.

The page-background token is named `canvas`, not `base`: a `--color-base` entry
makes Tailwind emit a `text-base` *color* utility that shadows the built-in
`text-base` *font-size* utility, which silently paints every heading in the
near-black page color.

| Token | Value | Use |
| --- | --- | --- |
| `--color-canvas` | `#0A0E14` | Page background |
| `--color-surface` | `#111823` | Cards, sidebar |
| `--color-elevated` | `#18202C` | Table headers, hover rows, inputs |
| `--color-line` | `rgba(255,255,255,0.07)` | Hairline borders |
| `--color-line-strong` | `rgba(255,255,255,0.14)` | Dividers under headings |
| `--color-text` | `#E6EDF5` | Primary text |
| `--color-dim` | `#8494A6` | Secondary text, axis labels |
| `--color-faint` | `#5A6878` | Eyebrows, placeholders |
| `--color-gain` | `#3FDD8A` | Positive P&L |
| `--color-loss` | `#FF6B6B` | Negative P&L |
| `--color-warn` | `#F5B54A` | Stale-price banner |

### Typography

Both faces load through `next/font/google`. The current stylesheet names `Inter`
without ever loading it, so the app silently falls back to system sans today.

- **Geist** — all UI text.
- **Geist Mono** with `font-variant-numeric: tabular-nums` — every monetary
  value, quantity, and percentage. Tabular figures keep columns aligned and stop
  digits jittering when prices refresh.
- Net-worth hero: 64px desktop / clamp down to 38px mobile, weight 500,
  tracking `-0.04em`.
- Eyebrows: 10px, 700, `0.14em` tracking, uppercase, `--color-faint`.

### Depth

Dark surfaces read as flat unless they are lit. Every card carries:

```
border: 1px solid var(--color-line);
border-radius: 14px;
box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.4),
            0 8px 24px -12px rgba(0,0,0,0.6);
```

The inset top highlight is what separates a lit card from a grey rectangle.

### Motion

Transitions are 150ms ease-out on hover and focus only. No entrance animations.
The existing `prefers-reduced-motion` block is preserved.

## Implementation approach

### Tailwind v4

Add `tailwindcss@^4`, `@tailwindcss/postcss`, and `postcss.config.mjs`. Tailwind
v4 is configured in CSS, so no `tailwind.config.js` is created. `app/globals.css`
becomes `@import "tailwindcss"` plus an `@theme` block holding the tokens above,
plus a short base layer for `body`, focus rings, and reduced motion.

The existing 1203 lines of hand-written CSS are **deleted**, not kept as a legacy
layer. Leaving both systems claiming the same class names (`.dashboard-panel`,
`.section-heading`, `.holdings-table`) is how a reskin ends up half-applied.
Every component's `className` is rewritten in the same pass.

### Shared primitives

Repeated chrome is extracted into presentational components under
`components/ui/` rather than `@apply` rules, so the 764-line `WalletsManager` and
520-line `ImportWizard` do not become utility-class soup:

| Component | Purpose |
| --- | --- |
| `Card` | Surface, border, radius, shadow; optional `padded` |
| `SectionHeading` | Eyebrow + title on the left, meta slot on the right |
| `StatTile` | Label, value, delta, optional share-of-portfolio bar |
| `Button` | `primary` \| `secondary` \| `danger` \| `ghost` variants |
| `Field` | Label + input/select wrapper with consistent focus ring |
| `DataTable` | Scroll container, sticky header, zebra-free hover rows |

Each is a thin, dependency-free component: it takes props, renders markup, and
holds no state.

## Per-page design

### Shell (`AppShell`, `SidebarNav`)

- Desktop sidebar widens 216px → 240px, `--color-surface` against the darker
  page base, wordmark at top, nav items as rounded pills with a solid
  `--color-elevated` fill and a white left bar when active.
- Sidebar footer shows the base currency.
- **Mobile navigation is replaced.** Today four links wrap inside a
  `max-width: 70vw` cluster in the top bar and `/import` is dropped entirely on
  mobile. It becomes a fixed bottom tab bar carrying all five destinations, with
  the page gaining bottom padding to clear it.

### Home (`DashboardClient`)

1. **Net-worth hero card** — eyebrow, total, valuation timestamp, and a delta
   pill (arrow + absolute + percent) tinted gain or loss.
2. **Stat tile row** — Equities, Crypto, Manual: each with subtotal and share of
   portfolio as a thin bar. Computed from `data.valuation.holdings`, which is
   already loaded; no new queries or server changes.
3. **History chart card** — restyled Recharts area: gradient fill from
   `--color-gain` at 22% to transparent, 2px line, grid hidden, axis labels in
   `--color-dim`, and a custom dark tooltip card replacing the default white one.
4. **Holdings sections** — one card per asset class, restyled table on desktop
   and list on mobile.

### Holdings (`HoldingsPageClient`, `HoldingsManager`, `HoldingForm`)

Page header, then one card per asset class. Each position is a row with symbol,
name, units, value, and P&L; the lots disclosure keeps its `<details>` structure
with a restyled chevron and an inset `--color-canvas` panel when open. Add-holding
forms move into cards with the new `Field` and `Button` primitives.

### Wallets (`WalletsManager`)

Structure is unchanged — this is the largest file and its behaviour is
load-bearing. Restyled: wallet rows become cards, addresses render in Geist Mono
at `--color-dim` with wrapping preserved, the add-wallet and xpub forms use
`Field`, and cost-coverage figures pick up the gain/loss/warn tokens.

### Import (`ImportWizard`, `PastImports`)

`ImportWizard.module.css` is rewritten against the same tokens rather than
deleted, since it is already scoped and its class names are local. Step markers,
the drop zone, the preview table, and the commit bar all move to dark surfaces.
Past-import rows become cards.

### Settings (`SettingsForm`, `ResetPortfolioForm`)

Two cards. The reset card is bordered in a muted `--color-loss` to mark it as
destructive without shouting.

## Table treatment

Applies to the Home holdings table, the lots table, and the wallets transfer
table:

- Header row on `--color-elevated`, 9px uppercase labels in `--color-faint`,
  sticky within its scroll container.
- Rows separated by `--color-line`, hovering to `--color-elevated`.
- All numeric cells right-aligned, Geist Mono, tabular figures.
- P&L cells show the absolute figure with the percentage beneath in a smaller
  size, both tinted by direction.
- Horizontal scroll containers keep their own `overflow-x: auto`; the page body
  never scrolls sideways.

## Incidental fix

`formatMoney` and `formatSignedMoney` are re-exported from
`components/NetWorthHeader.tsx` and imported from there by `HoldingsTable`,
`HoldingsList`, and `HoldingsManager`, even though they are defined in
`lib/format-money`. Those three imports are pointed at `lib/format-money`
directly and the re-export is dropped, since all four files are being rewritten
anyway.

## Out of scope

- Light mode and any theme toggle.
- Chart range selectors (1M / 3M / 1Y / ALL).
- Allocation donut or treemap.
- Any change to server actions, database access, pricing, or valuation logic.
- Restructuring `WalletsManager` or `ImportWizard` beyond styling.

## Verification

1. `npm run lint` — clean.
2. `npm test` — the existing suite passes unchanged. Checked: no test asserts on
   CSS class names. `tests/sidebar-nav.test.tsx` passes `className="desktop-nav"`
   as a prop but never asserts on it, so `SidebarNav` keeps its
   `{ links, className, ariaLabel }` prop signature and the test stays valid.
3. `npm run build` — succeeds.
4. `npm run dev`, then drive the app and screenshot all five pages at 390px and
   1440px. Confirm: no light-mode remnants, no horizontal body scroll, focus
   rings visible on every interactive element, and the bottom tab bar clearing
   page content on mobile.

## Amendments

Recorded after implementation. The visual design shipped exactly as specified;
these are the technical deviations forced by the deployment target.

### Tailwind v3, not v4

The spec's "Tailwind v4" decision did not survive contact with the Pi. v4's
engine `@tailwindcss/oxide` declares `engines: node >= 20`, so npm skips its
armv7 binary on the Node 18 build image, and the CSS pipeline then fails on a
missing native `lightningcss.linux-arm-gnueabihf.node`. The Pi is armv7 with
glibc 2.28 and could not meet v4's requirements.

v3 is pure JS with no native dependencies. Tokens moved from the `@theme` block
into `tailwind.config.js`, mirrored as custom properties in `globals.css` for
`ImportWizard.module.css`. Rendered output is unchanged — verified by screenshot
comparison of both builds.

Three v3 gaps had to be closed, all of which fail silently rather than erroring,
so each was checked against the compiled CSS rather than trusting a green build:

- v3's opacity scale lacks `8`, `45` and `85` — would have dropped the amber
  stale-price banner and disabled-button dimming. Extended in the config.
- `max-w-32` / `min-w-45` do not exist outside v4's spacing scale — replaced
  with arbitrary values.
- v3's `outline-2` sets only `outline-width`; without `outline` for the style,
  **every focus ring would have been invisible**.

### Deployment moved into a container

Not part of this spec's scope, noted here because it constrains the CSS stack.
The Pi host cannot run Node 20+ at all (its libstdc++ provides `GLIBCXX_3.4.25`,
node 20+ needs `3.4.26`; side-loading a newer libstdc++ fails because that needs
`GLIBC_2.29` against Buster's 2.28). Rather than dist-upgrade a host also running
homebridge, nginx, docker and tailscale, the app now runs in `node:22-bullseye`
on the Pi's existing Docker. See `README.md` and `deploy/pi/`.

This does not unblock Tailwind v4: the build image is now Node 22, but v3 is
working, verified and carries no native dependencies, so there is no reason to
move back.
