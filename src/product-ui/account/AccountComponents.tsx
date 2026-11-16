import { LoaderCircle } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "../utils";

export function AccountSection({
  id,
  title,
  description,
  icon,
  action,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  const headingId = id ?? `account-section-${generatedId}`;
  return (
    <section
      aria-labelledby={headingId}
      data-product-account-section=""
      className={cn(
        "min-w-0 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-5 sm:p-6",
        className,
      )}
    >
      <header
        className={cn("flex flex-wrap items-center justify-between gap-4", children && "mb-5")}
      >
        <div data-product-account-section-heading="" className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className="mt-0.5 shrink-0 text-[var(--pui-muted)]" aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold leading-6 text-[var(--pui-text)]">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm leading-6 text-[var(--pui-muted)]">{description}</p>
            )}
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
export function AccountNotice({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "danger" | "success";
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : tone === "success" ? "status" : undefined}
      className={cn(
        "rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] px-4 py-3 text-sm leading-6 [overflow-wrap:anywhere]",
        tone === "danger" ? "text-[var(--pui-danger)]" : "text-[var(--pui-muted)]",
      )}
    >
      {children}
    </div>
  );
}
export function AccountSpinner() {
  return (
    <LoaderCircle
      size={16}
      className="shrink-0 animate-spin motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}
export function AccountLoading({ title, announce = true }: { title: string; announce?: boolean }) {
  return (
    <div
      role={announce ? "status" : undefined}
      className="flex items-center gap-2 py-5 text-sm text-[var(--pui-muted)]"
    >
      <AccountSpinner />
      <p>{title}</p>
    </div>
  );
}
