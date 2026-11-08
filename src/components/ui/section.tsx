import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "./utils";

/** A document section is separated by its heading and a rule, rather than another card. */
export function Section({
  title,
  description,
  action,
  headingLevel = 2,
  className,
  children,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const headingId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      data-slot="section"
      aria-labelledby={headingId}
      className={cn("ui-section", className)}
      {...props}
    >
      <header className="ui-section__header">
        <div>
          <Heading id={headingId}>{title}</Heading>
          {description && <div className="ui-section__description">{description}</div>}
        </div>
        {action && <div className="ui-section__action">{action}</div>}
      </header>
      <div className="ui-section__content">{children}</div>
    </section>
  );
}

export function ActionGroup({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="action-group" className={cn("ui-actions", className)} {...props} />;
}
