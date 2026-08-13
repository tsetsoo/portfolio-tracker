export function OutdatedBanner() {
  return (
    <aside
      role="status"
      className="flex items-center gap-3 rounded-card border border-warn/25 bg-warn/8 px-4 py-3"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-warn/50 text-[11px] font-bold text-warn"
      >
        !
      </span>
      <p className="text-xs text-dim">
        <strong className="font-semibold text-warn">
          Some prices are outdated.
        </strong>{" "}
        Refresh to request current market and exchange-rate data.
      </p>
    </aside>
  );
}
