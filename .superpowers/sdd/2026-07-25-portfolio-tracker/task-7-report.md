# Task 7 report: App shell and Home dashboard

Implemented a responsive portfolio dashboard with a deep-ink financial
interface. Mobile uses a stacked valuation, history chart, and simple holdings
list with a compact Home/Settings header. At 900px and above, the layout
switches to a persistent Home/Holdings/Import/Settings sidebar and a dense
holdings table with units, unit cost, basis, value, and P&L.

The Home server component values the portfolio, records today's snapshot, and
loads history for a Recharts area chart. Stale pricing displays an outdated-data
banner, while the refresh form invokes `forceRefreshPortfolio` to bypass quote
and FX caches and revalidate the dashboard.

TDD and verification evidence:

- RED: the dashboard component test failed because the new AppShell did not
  exist.
- GREEN: 3 dashboard rendering tests passed.
- Full verification: 9 test files and 30 tests passed.
- `npm run lint`, `npm run build`, and `git diff --check` completed
  successfully.
- The development server returned HTTP 200 and rendered the refresh control,
  history section, holdings section, and empty state.
