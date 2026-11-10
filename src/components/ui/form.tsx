import {
  Checkbox,
  Input as HeadlessInput,
  RadioGroup as HeadlessRadioGroup,
  Textarea as HeadlessTextarea,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Radio,
} from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";
import {
  type ChangeEvent,
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
  useState,
} from "react";
import { cn, definedProps } from "./utils";

function change<T>(handler: ((event: ChangeEvent<T>) => void) | undefined, target: object) {
  handler?.({
    target,
    currentTarget: target,
    preventDefault() {},
    stopPropagation() {},
  } as ChangeEvent<T>);
}
/** Visible controls use Headless UI; hidden file inputs retain the permission boundary. */
export function Input({
  className,
  type,
  onChange,
  checked,
  defaultChecked,
  value,
  name,
  disabled,
  ref,
  ...props
}: ComponentProps<"input">) {
  const [local, setLocal] = useState(Boolean(defaultChecked));
  if (type === "checkbox" || type === "radio") {
    const selected = checked ?? local;
    const controlProps = {
      ...props,
      disabled,
      className: cn("ui-choice", type === "radio" && "ui-choice--radio", className),
      "data-field-name": name,
    };
    const content = <Check size={12} aria-hidden="true" />;
    return (
      <>
        {type === "radio" ? (
          <Radio
            {...definedProps(controlProps as unknown as ComponentProps<"button">)}
            as="button"
            type="button"
            value={String(value ?? name ?? "on")}
            ref={ref as never}
          >
            {content}
          </Radio>
        ) : (
          <Checkbox
            {...definedProps(controlProps as unknown as ComponentProps<"button">)}
            as="button"
            type="button"
            checked={selected}
            ref={ref as never}
            onChange={(next) => {
              setLocal(next);
              change(onChange, {
                checked: next,
                value: value ?? "on",
                name: name ?? "",
                type,
                id: props.id ?? "",
              });
            }}
          >
            {content}
          </Checkbox>
        )}
        {name && selected && (
          <input type="hidden" name={name} value={value ?? "on"} disabled={disabled} />
        )}
      </>
    );
  }
  return (
    <HeadlessInput
      {...definedProps(props)}
      ref={ref ?? null}
      type={type}
      name={name}
      value={value}
      disabled={Boolean(disabled)}
      onChange={onChange}
      data-slot="input"
      className={cn("ui-input", className)}
    />
  );
}
export function RadioGroup({ children, ...props }: ComponentProps<typeof HeadlessRadioGroup>) {
  return <HeadlessRadioGroup {...definedProps(props)}>{children}</HeadlessRadioGroup>;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <HeadlessTextarea
      data-slot="textarea"
      className={cn("ui-input ui-textarea", className)}
      {...definedProps(props)}
    />
  );
}
type Option = { value: string; label: ReactNode; disabled: boolean };
function optionsFrom(children: ReactNode, disabled = false): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)
    )
      return [];
    if (child.type === "option")
      return [
        {
          value: String(child.props.value ?? child.props.children ?? ""),
          label: child.props.children,
          disabled: disabled || Boolean(child.props.disabled),
        },
      ];
    return optionsFrom(child.props.children, disabled || Boolean(child.props.disabled));
  });
}
export function Select({
  className,
  children,
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  multiple,
  ref,
  ...props
}: ComponentProps<"select">) {
  const options = optionsFrom(children);
  const [local, setLocal] = useState(
    defaultValue ?? options.find((item) => !item.disabled)?.value ?? "",
  );
  const selected = value ?? local;
  return (
    <Listbox
      value={selected}
      disabled={Boolean(disabled)}
      multiple={Boolean(multiple)}
      onChange={(next) => {
        setLocal(next);
        change(onChange, { value: next, name: name ?? "", id: props.id ?? "" });
      }}
    >
      <div className="ui-select-root">
        <ListboxButton
          {...definedProps(props as unknown as ComponentProps<"button">)}
          type="button"
          ref={ref as never}
          className={cn("ui-input ui-select", className)}
          data-slot="select"
          data-value={String(selected)}
        >
          <span>
            {options.find((item) => item.value === String(selected))?.label ?? "선택해 주세요"}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </ListboxButton>
        <ListboxOptions
          className="ui-select-options"
          anchor={{ to: "bottom start", gap: 6, padding: 12 }}
          portal
        >
          {options.map((item, index) => (
            <ListboxOption
              key={String(index) + item.value}
              value={item.value}
              data-value={item.value}
              disabled={item.disabled}
              className="ui-select-option"
            >
              {({ selected: active }) => (
                <>
                  <span>{item.label}</span>
                  {active && <Check size={16} aria-hidden="true" />}
                </>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
        {name && <input type="hidden" name={name} value={String(selected)} disabled={disabled} />}
      </div>
    </Listbox>
  );
}
export function Label({
  className,
  htmlFor,
  children,
  ...props
}: Omit<ComponentProps<"label">, "htmlFor"> & { htmlFor?: string }) {
  return (
    <label
      data-slot="label"
      htmlFor={htmlFor}
      className={cn("ui-label", className)}
      {...definedProps(props)}
    >
      {children}
    </label>
  );
}
export function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("ui-field-description", className)}
      {...definedProps(props)}
    />
  );
}
