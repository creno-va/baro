import { Button as HeadlessButton } from "@headlessui/react";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef, MouseEvent } from "react";
import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-[var(--pui-primary)] text-[var(--pui-on-primary)] hover:brightness-95",
        secondary:
          "border-[var(--pui-border)] bg-[var(--pui-surface)] text-[var(--pui-text)] hover:brightness-95",
        ghost:
          "border-transparent bg-transparent text-[var(--pui-text)] hover:text-[var(--pui-primary)]",
        danger:
          "border-transparent bg-[var(--pui-danger)] text-[var(--pui-on-primary)] hover:brightness-95",
      },
      size: {
        default: "px-4 py-2.5 text-sm",
        sm: "px-3 py-2 text-xs",
        icon: "h-11 w-11 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

type ButtonAppearance = VariantProps<typeof buttonVariants>;
export type ButtonProps = Omit<ComponentPropsWithRef<"button">, "style"> & ButtonAppearance;

export function Button({
  variant,
  size,
  className,
  type = "button",
  disabled = false,
  autoFocus = false,
  ref,
  ...props
}: ButtonProps) {
  return (
    <HeadlessButton
      {...props}
      {...(ref === undefined ? {} : { ref })}
      type={type}
      disabled={disabled}
      autoFocus={autoFocus}
      className={cn(buttonVariants({ variant, size }), className)}
    />
  );
}

export type ButtonLinkProps = Omit<ComponentPropsWithRef<"a">, "href" | "style"> &
  ButtonAppearance & { href: string; disabled?: boolean };

function navigationHref(value: string) {
  const href = value.trim();
  if (!href) return undefined;
  try {
    const url = new URL(href, "https://product-ui.invalid");
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

/** Native links keep navigation semantics; executable and data URL schemes never
 * become href attributes. Opening another tab cannot grant access to its opener. */
export function ButtonLink({
  href: value,
  variant,
  size,
  className,
  disabled = false,
  target,
  rel,
  tabIndex,
  onClick,
  ...props
}: ButtonLinkProps) {
  const href = navigationHref(value);
  const unavailable = disabled || !href;
  const safeRel =
    target === "_blank"
      ? [
          ...new Set([
            ...(rel?.split(/\s+/) ?? []).filter((part) => part && part.toLowerCase() !== "opener"),
            "noopener",
            "noreferrer",
          ]),
        ].join(" ")
      : rel;
  function click(event: MouseEvent<HTMLAnchorElement>) {
    if (unavailable) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }
  return (
    <a
      {...props}
      href={unavailable ? undefined : href}
      target={target}
      rel={safeRel}
      aria-disabled={unavailable || undefined}
      tabIndex={unavailable ? -1 : tabIndex}
      onClick={click}
      className={cn(buttonVariants({ variant, size }), className)}
    />
  );
}
