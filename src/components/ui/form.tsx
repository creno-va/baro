// Adapted from shadcn/ui (MIT); native controls preserve forms without hydration.
import type { ComponentProps } from "react";
import { cn } from "./utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input data-slot="input" className={cn("ui-input", className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea data-slot="textarea" className={cn("ui-input ui-textarea", className)} {...props} />
  );
}
export function Label({
  className,
  htmlFor,
  children,
  ...props
}: Omit<ComponentProps<"label">, "htmlFor"> & { htmlFor: string }) {
  return (
    <label data-slot="label" htmlFor={htmlFor} className={cn("ui-label", className)} {...props}>
      {children}
    </label>
  );
}
export function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p data-slot="field-description" className={cn("ui-field-description", className)} {...props} />
  );
}
