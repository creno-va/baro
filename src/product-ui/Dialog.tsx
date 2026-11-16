import {
  Description,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Dialog as HeadlessDialog,
} from "@headlessui/react";
import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "./Button";
import { useProductTheme } from "./Theme";
import { cn } from "./utils";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  titleId?: string;
  headerActions?: ReactNode;
  placement?: "center" | "responsive-sheet";
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  closeLabel?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  preserveMounted?: boolean;
  showCloseButton?: boolean;
  panelProps?: Omit<ComponentPropsWithoutRef<"div">, "children" | "style" | "className">;
  panelRef?: Ref<HTMLDivElement>;
};

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

export function Dialog({
  open,
  onClose,
  title,
  titleId,
  headerActions,
  placement = "center",
  description,
  children,
  footer,
  className,
  closeLabel = "닫기",
  initialFocus,
  returnFocusRef,
  preserveMounted = false,
  showCloseButton = true,
  panelProps,
  panelRef,
}: DialogProps) {
  const theme = useProductTheme();
  // Headless portal placeholders contain inline styles before mounting. Defer
  // them so server HTML remains compatible with the strict style-attribute CSP.
  const [clientReady, setClientReady] = useState(false);
  const previous = useRef(false);
  const origin = useRef<HTMLElement | null>(null);
  const explicitOrigin = useRef(returnFocusRef);
  explicitOrigin.current = returnFocusRef;
  useLayoutEffect(() => {
    if (returnFocusRef) {
      if (open && !previous.current && document.activeElement instanceof HTMLElement)
        origin.current = document.activeElement;
      if (previous.current && !open) restoreFocus(returnFocusRef.current ?? origin.current);
    }
    previous.current = open;
  }, [open, returnFocusRef]);
  useEffect(
    () => () => {
      if (previous.current && explicitOrigin.current)
        restoreFocus(explicitOrigin.current.current ?? origin.current);
    },
    [],
  );
  useEffect(() => setClientReady(true), []);
  if (!clientReady) return null;
  return (
    <HeadlessDialog
      open={open}
      static={preserveMounted}
      {...(preserveMounted ? { hidden: !open } : {})}
      onClose={onClose}
      {...(initialFocus ? { initialFocus } : {})}
      className={placement === "responsive-sheet" ? "fixed inset-0 z-50" : "relative z-50"}
      data-product-ui=""
      data-theme={theme}
    >
      <DialogBackdrop className="fixed inset-0 bg-black/40" />
      <div className="fixed inset-0 w-screen overflow-y-auto">
        <div
          className={
            placement === "responsive-sheet"
              ? "flex min-h-full items-end justify-center sm:items-center sm:p-6"
              : "flex min-h-full items-center justify-center p-4 sm:p-6"
          }
        >
          <DialogPanel
            {...panelProps}
            {...(panelRef ? { ref: panelRef } : {})}
            data-dialog=""
            className={cn(
              "w-full max-w-lg rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-6 text-[var(--pui-text)] shadow-xl",
              placement === "responsive-sheet" && "max-sm:max-w-none max-sm:rounded-b-none",
              className,
            )}
          >
            <header className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DialogTitle
                  {...(titleId === undefined ? {} : { id: titleId })}
                  className="text-lg font-semibold leading-snug"
                >
                  {title}
                </DialogTitle>
                {description && (
                  <Description className="mt-2 text-sm leading-relaxed text-[var(--pui-muted)]">
                    {description}
                  </Description>
                )}
              </div>
              {headerActions != null && (
                <div className="flex shrink-0 items-center gap-2">{headerActions}</div>
              )}
              {showCloseButton && (
                <Button variant="ghost" size="icon" aria-label={closeLabel} onClick={onClose}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="m6 6 12 12M6 18 18 6" />
                  </svg>
                </Button>
              )}
            </header>
            <div className="mt-5">{children}</div>
            {footer && (
              <footer className="mt-6 flex flex-wrap items-center justify-end gap-2">
                {footer}
              </footer>
            )}
          </DialogPanel>
        </div>
      </div>
    </HeadlessDialog>
  );
}
