import type { ComponentProps } from "react";
import { cn } from "./utils";

/** Native list semantics with a separate row action, never a button nested in a link. */
export function List({ className, ...props }: ComponentProps<"ul">) {
  return <ul data-slot="list" className={cn("ui-list", className)} {...props} />;
}
export function ListRow({ className, ...props }: ComponentProps<"li">) {
  return <li data-slot="list-row" className={cn("ui-list__row", className)} {...props} />;
}
export function ListLink({ className, ...props }: ComponentProps<"a">) {
  return <a data-slot="list-link" className={cn("ui-list__link", className)} {...props} />;
}
export function ListTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 data-slot="list-title" className={cn("ui-list__title", className)} {...props} />;
}
export function ListMeta({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="list-meta" className={cn("ui-list__meta", className)} {...props} />;
}
