import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./button";
import { cn } from "./utils";

function restoreFocus(opener: HTMLElement | null) {
  const activeModal = document.querySelector("dialog:modal");
  if (opener?.isConnected && (!activeModal || activeModal.contains(opener))) opener.focus();
}

/** shadcn-style modal backed by native dialog: no inline CSS or runtime style injection. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  variant = "dialog",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  variant?: "dialog" | "sheet";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    // Capture the element before React clears its ref during unmount.
    const dialog = ref.current;
    return () => {
      if (!dialog?.open) return;
      dialog.close();
      restoreFocus(previousFocus.current);
    };
  }, []);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      data-slot={variant}
      className={cn("ui-dialog", variant === "sheet" && "ui-sheet")}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={() => onOpenChange(false)}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const dialog = event.currentTarget;
        if (!(event.target instanceof Element) || event.target.closest("dialog") !== dialog) return;
        const focusable = [
          ...dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ].filter(
          (element) => element.closest("dialog") === dialog && element.getClientRects().length > 0,
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last && first) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClose={() => {
        onOpenChange(false);
        restoreFocus(previousFocus.current);
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onOpenChange(false);
      }}
    >
      <div className="ui-dialog__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <Button variant="ghost" size="icon" aria-label="닫기" onClick={() => onOpenChange(false)}>
          <X aria-hidden="true" size={20} />
        </Button>
      </div>
      <div className="ui-dialog__content">{children}</div>
    </dialog>
  );
}

export function Sheet(props: Omit<Parameters<typeof Dialog>[0], "variant">) {
  return <Dialog {...props} variant="sheet" />;
}
