import type { HTMLAttributes, ReactNode } from "react";

/** Page container. Bottom padding clears the fixed mobile tab bar. */
export function Page({
  children,
  width = "wide",
  className = "",
  ...rest
}: {
  children: ReactNode;
  width?: "wide" | "narrow" | "slim";
  className?: string;
} & HTMLAttributes<HTMLElement>) {
  const max =
    width === "slim"
      ? "max-w-3xl"
      : width === "narrow"
        ? "max-w-5xl"
        : "max-w-6xl";

  return (
    <main
      className={`mx-auto ${max} px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-9 ${className}`}
      {...rest}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
}) {
  return (
    <header className="border-b border-line pb-6">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-2 font-mono text-[clamp(32px,7vw,44px)] font-medium leading-[1.05] tracking-[-0.04em]">
        {title}
      </h1>
      {description && (
        <p className="mt-3 max-w-xl text-xs leading-relaxed text-dim">
          {description}
        </p>
      )}
    </header>
  );
}
