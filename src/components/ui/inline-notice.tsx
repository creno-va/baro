import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./utils";

export type NoticeTone = "neutral" | "success" | "warning" | "danger";
const icons = { neutral: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert };

/** Persistent inline context. An interrupted save must not disappear in a timed toast. */
export function InlineNotice({
  tone = "neutral",
  title,
  children,
  action,
  announce = false,
  className,
}: {
  tone?: NoticeTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Opt in only for a newly arrived result; static explanatory content stays quiet. */
  announce?: boolean;
  className?: string;
}) {
  const Icon = icons[tone];
  return (
    <div
      data-slot="notice"
      data-tone={tone}
      className={cn("ui-notice", className)}
      role={announce ? (tone === "danger" ? "alert" : "status") : undefined}
    >
      <Icon size={20} aria-hidden="true" />
      <div className="ui-notice__body">
        <p className="ui-notice__title">{title}</p>
        {children && <div className="ui-notice__description">{children}</div>}
        {action && <div className="ui-notice__action">{action}</div>}
      </div>
    </div>
  );
}
