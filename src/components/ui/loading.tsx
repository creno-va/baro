import { LoaderCircle } from "lucide-react";
import { Skeleton } from "./badge";
import { cn } from "./utils";
import "../../styles/feedback.css";

/** Decorative: the adjacent status or button label names the pending operation. */
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("ui-spinner", className)} size={18} aria-hidden="true" />;
}

/** Match the destination's structure without inventing progress or completion times. */
export function LoadingContent({
  title,
  layout = "list",
  announce = true,
}: {
  title: string;
  layout?: "list" | "directory" | "detail" | "usage";
  announce?: boolean;
}) {
  return (
    <div
      className={`ui-loading ui-loading--${layout}`}
      role={announce ? "status" : undefined}
      aria-busy="true"
    >
      <p className="ui-loading__label">
        <Spinner />
        {title}
      </p>
      <div className="ui-loading__structure" aria-hidden="true">
        {["first", "second", "third", "fourth"]
          .slice(0, layout === "usage" ? 4 : layout === "detail" ? 2 : 3)
          .map((key) => (
            <div className="ui-loading__item" key={key}>
              {layout !== "usage" && <Skeleton className="ui-loading__avatar" />}
              <div className="ui-loading__copy">
                <Skeleton className="ui-loading__title" />
                <Skeleton className="ui-loading__line" />
                <Skeleton className="ui-loading__short" />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
