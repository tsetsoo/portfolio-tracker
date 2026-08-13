import type { ReactNode } from "react";

export function SectionHeading({
  eyebrow,
  title,
  meta,
}: {
  eyebrow?: string;
  title: string;
  meta?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="mt-1 text-base font-semibold tracking-tight">{title}</h2>
      </div>
      {meta != null && (
        <span className="shrink-0 font-mono text-[10px] tracking-wide text-faint">
          {meta}
        </span>
      )}
    </div>
  );
}
