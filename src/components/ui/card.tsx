// Adapted from shadcn/ui (MIT); see LICENSE.shadcn.
import type { ComponentProps } from "react";
import { cn } from "./utils";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section data-slot="card" className={cn("ui-card", className)} {...props} />;
}
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("ui-card__header", className)} {...props} />;
}
export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cn("ui-card__title", className)} {...props} />;
}
export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p data-slot="card-description" className={cn("ui-card__description", className)} {...props} />
  );
}
export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("ui-card__content", className)} {...props} />;
}
