export function OutdatedBanner() {
  return (
    <aside className="outdated-banner" role="status">
      <span aria-hidden="true">!</span>
      <p>
        <strong>Some prices are outdated.</strong> Refresh to request current
        market and exchange-rate data.
      </p>
    </aside>
  );
}
