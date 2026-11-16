import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "../utils";

export const legacyLinkClass =
  "inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-[var(--pui-text)] underline decoration-[var(--pui-border)] underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)] [overflow-wrap:anywhere]";
export const legacyMutedClass = "text-sm leading-7 text-[var(--pui-muted)]";

export function LegacyCaseSection({
  title,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithRef<"section">, "title"> & { title?: ReactNode }) {
  return (
    <section
      {...props}
      data-product-legacy-section=""
      className={cn(
        "min-w-0 space-y-5 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-5 text-[var(--pui-text)] sm:p-7 [overflow-wrap:anywhere]",
        className,
      )}
    >
      {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
      {children}
    </section>
  );
}
