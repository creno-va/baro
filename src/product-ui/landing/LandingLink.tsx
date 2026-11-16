import { Button as HeadlessButton } from "@headlessui/react";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";
import { cn } from "../utils";
import { sceneClasses } from "./scene-classes";

const appearance = cva("", {
  variants: {
    variant: {
      primary: "demo-primary",
      secondary: "demo-secondary",
      restart: "demo-restart",
      text: "landing-text-link",
      brand: "brand",
      custom: "",
    },
  },
  defaultVariants: { variant: "primary" },
});
type Appearance = VariantProps<typeof appearance>;
export function LandingButton({
  variant,
  className,
  type = "button",
  disabled = false,
  autoFocus = false,
  ref,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "style"> & Appearance) {
  return (
    <HeadlessButton
      {...props}
      {...(ref === undefined ? {} : { ref })}
      disabled={disabled}
      autoFocus={autoFocus}
      type={type}
      className={cn(sceneClasses(appearance({ variant })), className)}
    />
  );
}
export function LandingLink({
  variant,
  className,
  ...props
}: Omit<ComponentPropsWithRef<"a">, "style"> & Appearance) {
  return <a {...props} className={cn(sceneClasses(appearance({ variant })), className)} />;
}
