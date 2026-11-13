import { Button as HeadlessButton } from "@headlessui/react";
import { useEffect, useRef } from "react";
import { cn } from "./utils";

/** Custom slider surface; Headless owns button focus, hover and disabled state. */
export function Range({
  label,
  value,
  max,
  step = 1,
  disabled = false,
  valueText,
  onChange,
  className,
}: {
  label: string;
  value: number;
  max: number;
  step?: number;
  disabled?: boolean;
  valueText?: string;
  onChange: (value: number) => void;
  className?: string;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const limit = Number.isFinite(max) && max > 0 ? max : 1;
  const current = Math.max(0, Math.min(limit, value));
  useEffect(() => {
    fill.current?.style.setProperty("width", String((current / limit) * 100) + "%");
  }, [current, limit]);
  const change = (next: number) => onChange(Math.max(0, Math.min(limit, next)));
  return (
    <HeadlessButton
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.round(current * 1000) / 1000}
      aria-valuetext={valueText}
      disabled={disabled}
      className={cn("ui-control ui-range", className)}
      onKeyDown={(event) => {
        const offsets: Record<string, number> = {
          ArrowLeft: -step,
          ArrowDown: -step,
          ArrowRight: step,
          ArrowUp: step,
          PageDown: -step * 10,
          PageUp: step * 10,
        };
        if (event.key === "Home" || event.key === "End" || event.key in offsets) {
          event.preventDefault();
          change(
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? limit
                : current + (offsets[event.key] ?? 0),
          );
        } else if (event.key === " ") event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || disabled) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        const bounds = event.currentTarget.getBoundingClientRect();
        if (bounds.width) change(((event.clientX - bounds.left) / bounds.width) * limit);
      }}
      onPointerMove={(event) => {
        if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (bounds.width) change(((event.clientX - bounds.left) / bounds.width) * limit);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <span className="ui-range__track" aria-hidden="true">
        <span className="ui-range__fill" ref={fill} />
      </span>
    </HeadlessButton>
  );
}
