import type { ReactNode } from "react";
import { cn } from "../utils";

export function ResolutionNotice({
  children,
  alert = false,
  className,
}: {
  children: ReactNode;
  alert?: boolean;
  className?: string;
}) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className={cn(
        "space-y-3 rounded-2xl border p-4 text-sm leading-7 sm:p-5 [overflow-wrap:anywhere]",
        alert
          ? "border-[var(--pui-danger)]/40 text-[var(--pui-danger)]"
          : "border-[var(--pui-border)] bg-[var(--pui-background)] text-[var(--pui-muted)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export const checkClass =
  "flex min-h-11 items-start gap-3 py-2 text-sm leading-7 has-disabled:opacity-60";
export const checkboxClass =
  "mt-1.5 h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]";
export const actionClass = "flex flex-wrap items-center gap-2";
