import {
  Description,
  Field,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";
import { type ReactNode, type Ref, useId } from "react";
import { Button } from "./Button";
import { useProductTheme } from "./Theme";
import { cn, useClientReady } from "./utils";

export type SelectFieldProps = {
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly { value: string; label: ReactNode; disabled?: boolean }[];
  disabled?: boolean;
  id?: string;
  name?: string;
  description?: ReactNode;
  error?: ReactNode;
  "aria-describedby"?: string;
  className?: string;
  wrapperClassName?: string;
  buttonRef?: Ref<HTMLButtonElement>;
};

/** Controlled values cross the UI boundary directly; no synthetic DOM events. */
export function SelectField({
  label,
  value,
  onValueChange,
  options,
  disabled = false,
  id,
  name,
  description,
  error,
  className,
  wrapperClassName,
  buttonRef,
  "aria-describedby": externalDescription,
}: SelectFieldProps) {
  const ready = useClientReady();
  const generatedId = useId();
  const theme = useProductTheme();
  const controlId = id ?? `pui-select-${generatedId}`;
  const labelId = `${controlId}-label`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [externalDescription, descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const selected = options.find((option) => option.value === value)?.label ?? "선택해 주세요";
  const controlClass = cn(
    "w-full justify-between rounded-xl border-[var(--pui-border)] bg-[var(--pui-surface)] px-3 text-left text-sm font-normal text-[var(--pui-text)] aria-invalid:border-[var(--pui-danger)]",
    className,
  );
  if (!ready)
    return (
      <div className={cn("grid gap-1.5", wrapperClassName)}>
        <label
          id={labelId}
          htmlFor={controlId}
          className="text-sm font-medium text-[var(--pui-text)]"
        >
          {label}
        </label>
        <Button
          id={controlId}
          {...(buttonRef ? { ref: buttonRef } : {})}
          variant="secondary"
          className={controlClass}
          disabled
          data-slot="select"
          data-value={value}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error) || undefined}
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{selected}</span>
          <ChevronDown size={16} className="shrink-0" aria-hidden="true" />
        </Button>
        {description && (
          <p id={descriptionId} className="text-xs leading-5 text-[var(--pui-muted)]">
            {description}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-xs leading-5 text-[var(--pui-danger)]">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <Field disabled={disabled} className={cn("grid gap-1.5", wrapperClassName)}>
      <Label
        id={labelId}
        htmlFor={controlId}
        className="text-sm font-medium text-[var(--pui-text)]"
      >
        {label}
      </Label>
      <Listbox
        value={value}
        onChange={onValueChange}
        disabled={disabled}
        {...(name ? { name } : {})}
      >
        <ListboxButton
          as={Button}
          {...(buttonRef ? { ref: buttonRef } : {})}
          id={controlId}
          variant="secondary"
          className={controlClass}
          data-slot="select"
          data-value={value}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error) || undefined}
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{selected}</span>
          <ChevronDown size={16} className="shrink-0" aria-hidden="true" />
        </ListboxButton>
        <ListboxOptions
          portal
          modal={false}
          anchor={{ to: "bottom start", gap: 6, padding: 12 }}
          data-product-ui=""
          data-theme={theme}
          className="z-[90] max-h-[min(360px,50dvh)] w-[var(--button-width)] min-w-40 max-w-[calc(100vw-24px)] overflow-auto rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-1 text-[var(--pui-text)] shadow-lg focus:outline-none"
        >
          {options.map((option) => (
            <ListboxOption
              key={option.value}
              value={option.value}
              disabled={Boolean(option.disabled)}
              data-value={option.value}
              className="flex min-h-11 cursor-default items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm data-focus:bg-[var(--pui-background)] data-selected:font-medium data-disabled:opacity-50"
            >
              {({ selected: active }) => (
                <>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
                  {active && <Check size={16} className="shrink-0" aria-hidden="true" />}
                </>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
      {description && (
        <Description id={descriptionId} className="text-xs leading-5 text-[var(--pui-muted)]">
          {description}
        </Description>
      )}
      {error && (
        <Description
          id={errorId}
          role="alert"
          className="text-xs leading-5 text-[var(--pui-danger)]"
        >
          {error}
        </Description>
      )}
    </Field>
  );
}
