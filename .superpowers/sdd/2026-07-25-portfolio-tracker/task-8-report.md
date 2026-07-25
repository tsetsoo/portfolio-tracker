# Task 8 report: Holdings and Settings pages

Implemented a holdings management page that uses `valuePortfolio` for current
values and the holdings repository for expandable lot history. Each lot shows
quantity, cost per unit, purchase date, and fees. Separate server-backed forms
add crypto lots and manual assets.

Implemented a settings page with a three-letter base-currency input. Currency
codes are trimmed, uppercased, and validated before persistence; saving
revalidates Home, Holdings, and Settings.

The new pages follow the responsive, ink-and-paper visual language established
by Task 7, including mono financial data, square controls, fine rules, and
mobile-first layouts.

TDD and verification evidence:

- RED: the focused Task 8 suite failed because the new management components
  did not exist.
- GREEN: 4 focused tests passed, covering lot details, both holding forms,
  settings rendering, and currency normalization/validation.
- Full verification: 10 test files and 34 tests passed.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check`
  completed successfully.
