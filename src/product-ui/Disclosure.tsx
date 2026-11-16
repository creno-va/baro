import {
  DisclosureButton,
  DisclosurePanel,
  Disclosure as HeadlessDisclosure,
} from "@headlessui/react";
import { ChevronDown } from "lucide-react";
import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
  useEffect,
  useRef,
} from "react";
import { cn, definedProps } from "./utils";

export function DisclosureSummary({ children, className, ...props }: ComponentProps<"button">) {
  const content = (
    <DisclosureButton
      {...definedProps(props)}
      data-disclosure-button=""
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-left text-sm font-medium text-[var(--pui-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]",
        className,
      )}
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {isValidElement<{ children: ReactNode }>(children) && children.type === "h3"
          ? children.props.children
          : children}
      </span>
      <ChevronDown
        size={16}
        className="shrink-0 text-[var(--pui-muted)] transition-transform [[data-open]_&]:rotate-180 motion-reduce:transition-none"
        aria-hidden="true"
      />
    </DisclosureButton>
  );
  return isValidElement(children) && children.type === "h3" ? <h3>{content}</h3> : content;
}

function Content({
  expanded,
  requested,
  onOpenChange,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "onToggle"> & {
  expanded: boolean;
  requested?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const lastRequested = useRef(requested);
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;
  useEffect(() => {
    notify.current?.(expanded);
  }, [expanded]);
  useEffect(() => {
    if (lastRequested.current === requested) return;
    lastRequested.current = requested;
    // Headless Disclosure exposes defaultOpen. Synchronize an explicit later
    // request through its native button, retaining the same mounted panel.
    if (requested !== undefined && requested !== expanded)
      root.current?.querySelector<HTMLButtonElement>("[data-disclosure-button]")?.click();
  }, [requested, expanded]);
  const nodes = Children.toArray(children);
  const summary = nodes.find((node) => isValidElement(node) && node.type === DisclosureSummary);
  return (
    <div
      {...props}
      ref={root}
      data-disclosure=""
      data-open={expanded || undefined}
      className={cn(
        "min-w-0 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] px-4 py-2",
        className,
      )}
    >
      {summary}
      <DisclosurePanel
        static
        hidden={!expanded}
        className="space-y-3 pb-3 pt-2 text-sm leading-6 text-[var(--pui-muted)] [&_a]:underline [&_a]:underline-offset-4 [&_ul]:list-disc [&_ul]:pl-5"
      >
        {nodes.filter((node) => node !== summary)}
      </DisclosurePanel>
    </div>
  );
}

export function Disclosure({
  open,
  onOpenChange,
  children,
  ...props
}: Omit<ComponentProps<"div">, "onToggle"> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <HeadlessDisclosure defaultOpen={open ?? false}>
      {({ open: expanded }) => (
        <Content {...props} expanded={expanded} requested={open} onOpenChange={onOpenChange}>
          {children}
        </Content>
      )}
    </HeadlessDisclosure>
  );
}
