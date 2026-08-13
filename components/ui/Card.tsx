import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "form";
}) {
  return (
    <Tag
      className={`rounded-card border border-line bg-surface shadow-card ${className}`}
    >
      {children}
    </Tag>
  );
}
