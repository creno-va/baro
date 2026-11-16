import { Description, Field, Input, Label, Textarea } from "@headlessui/react";
import { type AriaAttributes, type ComponentPropsWithRef, type ReactNode, useId } from "react";
import { cn, useClientReady } from "./utils";

type FieldAppearance = {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  wrapperClassName?: string;
};
export type InputFieldProps = Omit<ComponentPropsWithRef<"input">, "style" | "children"> &
  FieldAppearance;
export type TextareaFieldProps = Omit<ComponentPropsWithRef<"textarea">, "style"> & FieldAppearance;

const controlClass =
  "block min-h-11 w-full rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] px-3 py-2.5 text-sm text-[var(--pui-text)] placeholder:text-[var(--pui-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--pui-danger)]";

function describedBy(...ids: (string | undefined)[]) {
  const value = [...new Set(ids.flatMap((id) => id?.split(/\s+/).filter(Boolean) ?? []))].join(" ");
  return value || undefined;
}

type NativeAria = {
  callerDescription?: string | undefined;
  callerLabel?: string | undefined;
  callerInvalid?: AriaAttributes["aria-invalid"];
};
// Headless controls compute their own ARIA values after merging caller props.
// Keep the final native attributes explicit without converting native events.
function NativeInput({
  callerDescription,
  callerLabel,
  callerInvalid,
  ...props
}: ComponentPropsWithRef<"input"> & NativeAria) {
  return (
    <input
      {...props}
      aria-labelledby={callerLabel ?? props["aria-labelledby"]}
      aria-describedby={callerDescription}
      aria-invalid={callerInvalid}
    />
  );
}
function NativeTextarea({
  callerDescription,
  callerLabel,
  callerInvalid,
  ...props
}: ComponentPropsWithRef<"textarea"> & NativeAria) {
  return (
    <textarea
      {...props}
      aria-labelledby={callerLabel ?? props["aria-labelledby"]}
      aria-describedby={callerDescription}
      aria-invalid={callerInvalid}
    />
  );
}

function FieldContents({
  controlId,
  label,
  description,
  error,
  disabled,
  wrapperClassName,
  children,
  clientReady,
}: FieldAppearance & {
  controlId: string;
  disabled: boolean;
  children: ReactNode;
  clientReady: boolean;
}) {
  const LabelTag = clientReady ? Label : "label";
  const DescriptionTag = clientReady ? Description : "p";
  const content = (
    <>
      <LabelTag htmlFor={controlId} className="text-sm font-medium text-[var(--pui-text)]">
        {label}
      </LabelTag>
      {children}
      {description && (
        <DescriptionTag
          id={`${controlId}-description`}
          className="text-xs leading-relaxed text-[var(--pui-muted)]"
        >
          {description}
        </DescriptionTag>
      )}
      {error && (
        <DescriptionTag
          id={`${controlId}-error`}
          role="alert"
          className="text-xs leading-relaxed text-[var(--pui-danger)]"
        >
          {error}
        </DescriptionTag>
      )}
    </>
  );
  const className = cn("grid gap-1.5", wrapperClassName);
  // Headless Field adds a styled hidden form marker. Its native SSR frame has
  // the same visible elements and keeps inline style attributes out of HTML.
  return clientReady ? (
    <Field disabled={disabled} className={className}>
      {content}
    </Field>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function InputField({
  id,
  label,
  description,
  error,
  invalid = false,
  wrapperClassName,
  className,
  disabled = false,
  autoFocus = false,
  ref,
  "aria-describedby": externalDescription,
  "aria-labelledby": externalLabel,
  "aria-invalid": externalInvalid,
  ...props
}: InputFieldProps) {
  const generatedId = useId();
  const clientReady = useClientReady();
  const controlId = id ?? `pui-input-${generatedId}`;
  const hasError = Boolean(error);
  const ariaInvalid = hasError || invalid ? true : externalInvalid;
  return (
    <FieldContents
      controlId={controlId}
      label={label}
      description={description}
      error={error}
      disabled={disabled}
      clientReady={clientReady}
      {...(wrapperClassName ? { wrapperClassName } : {})}
    >
      <Input
        as={NativeInput}
        {...props}
        {...(ref === undefined ? {} : { ref })}
        id={controlId}
        disabled={disabled}
        autoFocus={autoFocus}
        invalid={hasError || invalid || Boolean(externalInvalid && externalInvalid !== "false")}
        callerInvalid={ariaInvalid}
        callerLabel={externalLabel}
        callerDescription={describedBy(
          externalDescription,
          description ? `${controlId}-description` : undefined,
          hasError ? `${controlId}-error` : undefined,
        )}
        className={cn(controlClass, className)}
      />
    </FieldContents>
  );
}

export function TextareaField({
  id,
  label,
  description,
  error,
  invalid = false,
  wrapperClassName,
  className,
  disabled = false,
  autoFocus = false,
  ref,
  "aria-describedby": externalDescription,
  "aria-labelledby": externalLabel,
  "aria-invalid": externalInvalid,
  ...props
}: TextareaFieldProps) {
  const generatedId = useId();
  const clientReady = useClientReady();
  const controlId = id ?? `pui-textarea-${generatedId}`;
  const hasError = Boolean(error);
  const ariaInvalid = hasError || invalid ? true : externalInvalid;
  return (
    <FieldContents
      controlId={controlId}
      label={label}
      description={description}
      error={error}
      disabled={disabled}
      clientReady={clientReady}
      {...(wrapperClassName ? { wrapperClassName } : {})}
    >
      <Textarea
        as={NativeTextarea}
        {...props}
        {...(ref === undefined ? {} : { ref })}
        id={controlId}
        disabled={disabled}
        autoFocus={autoFocus}
        invalid={hasError || invalid || Boolean(externalInvalid && externalInvalid !== "false")}
        callerInvalid={ariaInvalid}
        callerLabel={externalLabel}
        callerDescription={describedBy(
          externalDescription,
          description ? `${controlId}-description` : undefined,
          hasError ? `${controlId}-error` : undefined,
        )}
        className={cn(controlClass, "min-h-28 resize-y", className)}
      />
    </FieldContents>
  );
}
