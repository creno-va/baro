// Adapted from shadcn/ui (MIT), with native button semantics for Astro islands.
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { Spinner } from "./loading";
import { cn } from "./utils";

export const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button--primary",
      secondary: "ui-button--secondary",
      outline: "ui-button--outline",
      ghost: "ui-button--ghost",
      destructive: "ui-button--destructive",
    },
    size: { default: "ui-button--default", sm: "ui-button--sm", icon: "ui-button--icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export function Button({
  className,
  variant,
  size,
  type = "button",
  loading = false,
  children,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  return (
    <button
      data-slot="button"
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || props["aria-busy"] || undefined}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function ButtonLink({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"a"> & VariantProps<typeof buttonVariants>) {
  return (
    <a data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
