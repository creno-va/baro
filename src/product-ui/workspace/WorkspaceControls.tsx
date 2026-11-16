import type { ComponentPropsWithRef } from "react";
import { cn } from "../utils";

const inputClass =
  "min-h-11 w-full rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] px-3 py-2.5 text-sm leading-6 text-[var(--pui-text)] placeholder:text-[var(--pui-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--pui-danger)]";

/** Preserve native events, refs and labels of the existing working forms. */
export function WorkspaceInput({ className, type, ...props }: ComponentPropsWithRef<"input">) {
  return (
    <input
      {...props}
      type={type}
      className={cn(
        type === "checkbox"
          ? "h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)] disabled:opacity-50"
          : type === "file"
            ? undefined
            : inputClass,
        className,
      )}
    />
  );
}
export function WorkspaceTextarea({ className, ...props }: ComponentPropsWithRef<"textarea">) {
  return <textarea {...props} className={cn(inputClass, "min-h-28 resize-y", className)} />;
}
export function WorkspaceLabel({
  className,
  children,
  htmlFor,
  ...props
}: ComponentPropsWithRef<"label">) {
  return (
    <label
      {...props}
      htmlFor={htmlFor}
      className={cn(
        "flex min-h-11 items-center gap-3 text-sm font-medium leading-6 text-[var(--pui-text)]",
        className,
      )}
    >
      {children}
    </label>
  );
}
