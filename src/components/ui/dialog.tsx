import {
  Description,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Dialog as HeadlessDialog,
} from "@headlessui/react";
import { X } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { Button } from "./button";
import { cn, useClientReady } from "./utils";
export interface ModalProps extends Omit<ComponentProps<"div">, "title" | "onClose"> {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  variant?: "dialog" | "sheet";
}
function restoreFocus(destination: HTMLElement | null | undefined) {
  requestAnimationFrame(() => {
    const settledFocus = document.activeElement;
    requestAnimationFrame(() => {
      const current = document.activeElement;
      if (
        current !== settledFocus &&
        current !== destination &&
        current instanceof HTMLElement &&
        current !== document.body &&
        current !== document.documentElement &&
        current.isConnected &&
        !current.closest("[hidden], [inert]")
      )
        return;
      if (destination?.isConnected && !destination.closest("[inert], [hidden]"))
        destination.focus({ preventScroll: true });
    });
  });
}
function modalFocusTarget(panel: HTMLElement | null) {
  const controls = panel
    ? [
        ...panel.querySelectorAll<HTMLElement>(
          '[data-autofocus], button, input:not([type="hidden"]):not([type="file"]), textarea, a[href], [tabindex="0"]',
        ),
      ].filter(
        (node) =>
          !node.matches(":disabled, [aria-disabled=true]") &&
          !node.closest("[hidden]") &&
          (!node.isConnected || getComputedStyle(node).display !== "none"),
      )
    : [];
  return controls.find((node) => node.hasAttribute("data-autofocus")) ?? controls[0] ?? null;
}
export function Modal({
  open,
  onClose,
  children,
  className,
  title,
  variant = "dialog",
  returnFocusRef,
  ref,
  ...props
}: ModalProps) {
  const clientReady = useClientReady();
  const previous = useRef(false);
  const origin = useRef<HTMLElement | null>(null);
  const initialFocus = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const opened = useRef(open);
  opened.current = open;
  const capturePanel = useCallback(
    (node: HTMLDivElement | null) => {
      panel.current = node;
      initialFocus.current = opened.current ? modalFocusTarget(node) : null;
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
    },
    [ref],
  );
  // Headless keeps a stable merged ref when a closed static portal reopens.
  useLayoutEffect(() => {
    initialFocus.current = clientReady && open ? modalFocusTarget(panel.current) : null;
  }, [open, clientReady]);
  const explicitOrigin = useRef(returnFocusRef);
  explicitOrigin.current = returnFocusRef;
  useLayoutEffect(() => {
    if (open && !previous.current && document.activeElement instanceof HTMLElement)
      origin.current = document.activeElement;
    if (previous.current && !open) {
      restoreFocus(returnFocusRef?.current ?? origin.current);
    }
    previous.current = open;
  }, [open, returnFocusRef]);
  useEffect(
    () => () => {
      if (previous.current) restoreFocus(explicitOrigin.current?.current ?? origin.current);
    },
    [],
  );
  if (!clientReady) return null;
  return (
    <HeadlessDialog
      static
      hidden={!open}
      open={open}
      initialFocus={initialFocus}
      onClose={onClose}
      className={cn("ds-modal", variant === "sheet" && "ds-modal--sheet")}
    >
      <DialogBackdrop className="ds-modal__backdrop" />
      <div className="ds-modal__position">
        <DialogPanel
          {...props}
          ref={capturePanel}
          className={className}
          data-dialog=""
          data-open={open || undefined}
        >
          {title && (
            <DialogTitle as="span" className="sr-only">
              {title}
            </DialogTitle>
          )}
          {children}
        </DialogPanel>
      </div>
    </HeadlessDialog>
  );
}
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  variant = "dialog",
  returnFocusRef,
  showCloseButton = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  variant?: "dialog" | "sheet";
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  showCloseButton?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      variant={variant}
      returnFocusRef={returnFocusRef}
      className={cn("ui-dialog", variant === "sheet" && "ui-sheet")}
    >
      <div className="ui-dialog__header">
        <div>
          <DialogTitle as="h2">{title}</DialogTitle>
          {description && (
            <Description className="ui-dialog__description">{description}</Description>
          )}
        </div>
        {showCloseButton && (
          <Button variant="ghost" size="icon" aria-label="닫기" onClick={() => onOpenChange(false)}>
            <X size={20} aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="ui-dialog__content">{children}</div>
    </Modal>
  );
}
export function Sheet(props: Omit<Parameters<typeof Dialog>[0], "variant">) {
  return <Dialog {...props} variant="sheet" />;
}
