import { type ComponentProps, useEffect, useRef } from "react";
import { cn } from "./utils";
export function Progress({
  value,
  max = 100,
  className,
  children,
  ...props
}: ComponentProps<"progress">) {
  const bar = useRef<HTMLSpanElement>(null);
  const percentage =
    value === undefined
      ? null
      : Math.max(0, Math.min(100, (Number(value) / (Number(max) || 100)) * 100));
  useEffect(() => {
    if (bar.current) bar.current.style.width = String(percentage ?? 30) + "%";
  }, [percentage]);
  return (
    <div
      {...(props as ComponentProps<"div">)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage === null ? undefined : Math.round(percentage * 1000) / 1000}
      aria-valuetext={
        value === undefined
          ? undefined
          : Number(value).toLocaleString("en-US", {
              useGrouping: false,
              maximumSignificantDigits: 21,
            }) +
            " / " +
            Number(max).toLocaleString("en-US", {
              useGrouping: false,
              maximumSignificantDigits: 21,
            })
      }
      className={cn("ui-progress", percentage === null && "ui-progress--indeterminate", className)}
    >
      <span ref={bar} className="ui-progress__bar" />
      <span className="sr-only">{children}</span>
    </div>
  );
}
