import {
  Description,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Dialog as HeadlessDialog,
} from "@headlessui/react";
import { X } from "lucide-react";
import { type ComponentProps, type ReactNode, type RefObject, useEffect, useRef } from "react";
import { Button } from "./button";
import { cn } from "./utils";
export interface ModalProps extends Omit<ComponentProps<"div">, "title" | "onClose"> {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  variant?: "dialog" | "sheet";
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
  const previous = useRef(open);
  useEffect(() => {
    if (previous.current && !open && returnFocusRef?.current?.isConnected) {
      const destination = returnFocusRef.current;
      requestAnimationFrame(
        () => destination.isConnected && destination.focus({ preventScroll: true }),
      );
    }
    previous.current = open;
  }, [open, returnFocusRef]);
  return (
    <HeadlessDialog
      static
      hidden={!open}
      open={open}
      onClose={onClose}
      className={cn("ds-modal", variant === "sheet" && "ds-modal--sheet")}
    >
      <DialogBackdrop className="ds-modal__backdrop" />
      <div className="ds-modal__position">
        <DialogPanel
          {...props}
          ref={ref ?? null}
          className={className}
          data-dialog=""
          data-open={open || undefined}
        >
          {title && <DialogTitle className="sr-only">{title}</DialogTitle>}
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
