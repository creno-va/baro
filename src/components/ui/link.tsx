import type { ComponentProps } from "react";
import { cn } from "./utils";

export function TextLink({ className, ...props }: ComponentProps<"a">) {
  return <a data-slot="link" className={cn("ui-link", className)} {...props} />;
}
