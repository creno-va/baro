import type { ComponentProps } from "react";
import { cn } from "./utils";

/** Typography only. Content, provenance and trust decisions remain with the domain owner. */
export function ReadingContent({
  className,
  width = "reading",
  ...props
}: ComponentProps<"div"> & { width?: "reading" | "wide" | "full" }) {
  return (
    <div
      data-slot="reading-content"
      data-width={width}
      className={cn("ui-reading", className)}
      {...props}
    />
  );
}

/** The table itself keeps native semantics; only this labelled region can scroll horizontally. */
export function TableScroll({
  label,
  className,
  ...props
}: Omit<ComponentProps<"section">, "role" | "tabIndex" | "aria-label"> & { label: string }) {
  return (
    <section
      data-slot="table-scroll"
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Horizontal table scrolling must be keyboard reachable.
      tabIndex={0}
      className={cn("ui-table-scroll", className)}
      {...props}
    />
  );
}

/** Callers supply an already-validated destination; this component performs no lookup. */
export function SourceReference({ className, ...props }: ComponentProps<"a">) {
  return <a data-slot="source-reference" className={cn("ui-source", className)} {...props} />;
}
