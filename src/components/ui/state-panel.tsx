import {
  CircleAlert,
  Clock3,
  FileText,
  LoaderCircle,
  LockKeyhole,
  ShieldAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./utils";

export type StateVariant = "loading" | "empty" | "error" | "limit" | "permission" | "pending";
const icons = {
  loading: LoaderCircle,
  empty: FileText,
  error: CircleAlert,
  limit: ShieldAlert,
  permission: LockKeyhole,
  pending: Clock3,
};

export function StatePanel({
  variant,
  title,
  description,
  action,
  className,
}: {
  variant: StateVariant;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = icons[variant];
  return (
    <div
      data-slot="state-panel"
      data-state={variant}
      className={cn("ui-state", `ui-state--${variant}`, className)}
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
      aria-busy={variant === "loading"}
    >
      <span className="ui-state__icon">
        <Icon aria-hidden="true" size={24} strokeWidth={1.75} />
      </span>
      <div className="ui-state__body">
        <p className="ui-state__title">{title}</p>
        {description && <p className="ui-state__description">{description}</p>}
        {action && <div className="ui-state__action">{action}</div>}
      </div>
    </div>
  );
}
