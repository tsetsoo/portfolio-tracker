import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-text text-base hover:bg-white",
  secondary:
    "border border-line bg-elevated text-text hover:border-line-strong hover:text-white",
  danger: "border border-loss/40 text-loss hover:bg-loss hover:text-base",
  ghost: "text-dim hover:text-text",
};

const BASE =
  "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors duration-150 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 " +
  "disabled:cursor-not-allowed disabled:opacity-45";

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: { variant?: Variant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
