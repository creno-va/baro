import { type ReactNode, useId, useRef, useState } from "react";
import { cn } from "./utils";

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}
/** Manual activation: arrows move focus, Enter/Space selects, Home/End reach endpoints. */
export function Tabs({
  items,
  label,
  defaultValue,
  className,
}: {
  items: TabItem[];
  label: string;
  defaultValue?: string;
  className?: string;
}) {
  const id = useId();
  const [requested, setSelected] = useState(defaultValue);
  const selected =
    items.find((item) => item.value === requested && !item.disabled)?.value ??
    items.find((item) => !item.disabled)?.value;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div className={cn("ui-tabs", className)} data-slot="tabs">
      <div className="ui-tabs__list" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            type="button"
            role="tab"
            key={item.value}
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            aria-selected={selected === item.value}
            tabIndex={selected === item.value ? 0 : -1}
            disabled={item.disabled}
            ref={(node) => {
              refs.current[index] = node;
            }}
            onClick={() => setSelected(item.value)}
            onKeyDown={(event) => {
              const available = items.flatMap((tab, i) => (tab.disabled ? [] : [i]));
              const position = available.indexOf(index);
              const next =
                event.key === "Home"
                  ? available[0]
                  : event.key === "End"
                    ? available.at(-1)
                    : event.key === "ArrowRight"
                      ? available[(position + 1) % available.length]
                      : event.key === "ArrowLeft"
                        ? available[(position - 1 + available.length) % available.length]
                        : undefined;
              if (next !== undefined) {
                event.preventDefault();
                refs.current[next]?.focus();
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <div
          className="ui-tabs__panel"
          key={item.value}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          hidden={selected !== item.value}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: A text-only ARIA tabpanel needs keyboard focus so its content can be reached.
          tabIndex={0}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
