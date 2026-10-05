import type { ComponentProps } from "react";
import { cn } from "./utils";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: ComponentProps<"span"> & { tone?: "neutral" | "primary" | "success" | "warning" | "danger" }) {
  return (
    <span data-slot="badge" className={cn("ui-badge", `ui-badge--${tone}`, className)} {...props} />
  );
}
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("ui-skeleton", className)}
      {...props}
    />
  );
}
export function Separator({ className, ...props }: ComponentProps<"hr">) {
  return <hr data-slot="separator" className={cn("ui-separator", className)} {...props} />;
}
