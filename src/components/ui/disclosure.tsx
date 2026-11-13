import {
  DisclosureButton,
  DisclosurePanel,
  Disclosure as HeadlessDisclosure,
} from "@headlessui/react";
import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { cn, definedProps } from "./utils";
export interface DisclosureHandle {
  readonly open: boolean;
  close: () => void;
  contains: (node: Node | null) => boolean;
  closest: (selector: string) => Element | null;
  focusTrigger: () => void;
}
export function DisclosureSummary({
  className,
  variant = "text",
  ...props
}: ComponentProps<"button"> & { variant?: "text" | "icon" }) {
  return (
    <DisclosureButton
      {...definedProps(props)}
      className={cn("ui-control ui-disclosure__trigger", className)}
      data-disclosure-button=""
      data-variant={variant}
    />
  );
}
function Content({
  open,
  close,
  requested,
  children,
  handle,
  onToggle,
  ...props
}: Omit<ComponentProps<"div">, "onToggle"> & {
  open: boolean;
  close: () => void;
  requested?: boolean | undefined;
  handle?: Ref<DisclosureHandle> | undefined;
  onToggle?: ((event: { currentTarget: { open: boolean } }) => void) | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const lastRequested = useRef(requested);
  const toggle = useRef(onToggle);
  toggle.current = onToggle;
  useImperativeHandle(
    handle,
    () => ({
      open,
      close: () => {
        if (open) close();
      },
      contains: (node) => root.current?.contains(node) ?? false,
      closest: (selector) => root.current?.closest(selector) ?? null,
      focusTrigger: () =>
        root.current?.querySelector<HTMLElement>("[data-disclosure-button]")?.focus(),
    }),
    [open, close],
  );
  useEffect(() => {
    toggle.current?.({ currentTarget: { open } });
  }, [open]);
  useEffect(() => {
    if (lastRequested.current === requested) return;
    lastRequested.current = requested;
    if (requested !== undefined && requested !== open)
      root.current?.querySelector<HTMLButtonElement>("[data-disclosure-button]")?.click();
  }, [requested, open]);
  useEffect(() => {
    const node = root.current;
    const dismiss = () => {
      if (open) close();
    };
    node?.addEventListener("baro-disclosure-close", dismiss);
    return () => node?.removeEventListener("baro-disclosure-close", dismiss);
  }, [close, open]);
  const nodes = Children.toArray(children);
  const summary = nodes.find((node) => isValidElement(node) && node.type === DisclosureSummary);
  return (
    <div {...definedProps(props)} ref={root} data-disclosure="" data-open={open || undefined}>
      {summary}
      <DisclosurePanel static hidden={!open} className="ui-disclosure__panel">
        {nodes.filter((node) => node !== summary)}
      </DisclosurePanel>
    </div>
  );
}
export function Disclosure({
  open,
  children,
  ref,
  onToggle,
  ...props
}: Omit<ComponentProps<"div">, "onToggle" | "ref"> & {
  open?: boolean;
  ref?: Ref<DisclosureHandle>;
  onToggle?: ((event: { currentTarget: { open: boolean } }) => void) | undefined;
  children: ReactNode;
}) {
  return (
    <HeadlessDisclosure defaultOpen={open ?? false}>
      {({ open: expanded, close }) => (
        <Content
          {...definedProps(props)}
          open={expanded}
          close={close}
          requested={open}
          handle={ref}
          onToggle={onToggle}
        >
          {children}
        </Content>
      )}
    </HeadlessDisclosure>
  );
}
