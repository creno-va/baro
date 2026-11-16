import { Button as HeadlessButton } from "@headlessui/react";
import { useEffect, useRef } from "react";
import { cn } from "../utils";

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
      data-product-playback-range=""
      className={cn(
        "grid min-h-11 w-full min-w-0 touch-none select-none grid-cols-[minmax(0,1fr)] items-center rounded-lg border-0 bg-transparent px-1.5 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
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
      <span
        data-product-playback-track=""
        className="ui-range__track block h-1.5 w-full rounded-lg bg-[var(--pui-border)]"
        aria-hidden="true"
      >
        <span
          data-product-playback-fill=""
          className="relative block h-full w-0 rounded-[inherit] bg-[var(--pui-primary)] after:absolute after:-right-1.5 after:-top-[3px] after:h-3 after:w-3 after:rounded-full after:bg-[var(--pui-primary)] after:content-['']"
          ref={fill}
        />
      </span>
    </HeadlessButton>
  );
}
