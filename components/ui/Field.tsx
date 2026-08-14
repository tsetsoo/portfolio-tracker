import type { ReactNode } from "react";

/**
 * Input styling lives here as a class string applied to the wrapper, so plain
 * <input>/<select> children pick it up without every caller repeating it.
 */
export const FIELD_CONTROL =
  "[&_input]:w-full [&_input]:min-h-10 [&_input]:rounded-lg [&_input]:border [&_input]:border-line " +
  "[&_input]:bg-elevated [&_input]:px-3 [&_input]:font-mono [&_input]:text-[13px] [&_input]:text-text " +
  "[&_input::placeholder]:text-faint " +
  "[&_input:focus-visible]:outline [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-offset-2 [&_input:focus-visible]:outline-white/70 " +
  "[&_select]:w-full [&_select]:min-h-10 [&_select]:rounded-lg [&_select]:border [&_select]:border-line " +
  "[&_select]:bg-elevated [&_select]:px-3 [&_select]:text-[13px] [&_select]:text-text " +
  "[&_select:focus-visible]:outline [&_select:focus-visible]:outline-2 [&_select:focus-visible]:outline-offset-2 [&_select:focus-visible]:outline-white/70";

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid gap-1.5 ${FIELD_CONTROL} ${className}`}>
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-dim">{hint}</span>}
    </label>
  );
}
