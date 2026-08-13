import type { ReactNode } from "react";

/**
 * Scrolls sideways inside its own box so the page body never does.
 * Header cells and numeric cells are styled from here via descendant
 * selectors, keeping call sites free of repeated utility strings.
 */
export function DataTable({
  head,
  children,
  className = "",
}: {
  head: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-xs">
        <thead
          className={
            "bg-elevated [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[9px] " +
            "[&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.1em] [&_th]:text-faint " +
            "[&_th.numeric]:text-right"
          }
        >
          {head}
        </thead>
        <tbody
          className={
            "[&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-3 " +
            "[&_td.numeric]:text-right [&_td.numeric]:font-mono [&_td.numeric]:tabular-nums " +
            "[&_td.numeric]:whitespace-nowrap " +
            "[&_tr:hover]:bg-elevated [&_tr]:transition-colors [&_tr]:duration-150"
          }
        >
          {children}
        </tbody>
      </table>
    </div>
  );
}
