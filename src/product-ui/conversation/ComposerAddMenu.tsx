import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Plus } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { DisclosureHandle } from "../../components/ui/disclosure";
import { Button } from "../Button";
import { useProductTheme } from "../Theme";
import { useClientReady } from "../utils";

type Props = {
  ref?: Ref<DisclosureHandle> | undefined;
  triggerRef: RefObject<HTMLButtonElement | null>;
  children: (close: () => void) => ReactNode;
};
function MenuContents({
  open,
  close,
  root,
  ref,
  triggerRef,
  children,
}: Props & {
  open: boolean;
  close: (focus?: HTMLElement) => void;
  root: RefObject<HTMLDivElement | null>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const theme = useProductTheme();
  const closeWithoutMovingFocus = useCallback(() => {
    const active = document.activeElement;
    close(active instanceof HTMLElement ? active : undefined);
  }, [close]);
  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(triggerRef.current ?? undefined);
    } else if (event.key === "Tab") {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!root.current?.contains(active) && !panel.current?.contains(active))
          closeWithoutMovingFocus();
      });
    }
  };
  useImperativeHandle(
    ref,
    () => ({
      open,
      close: closeWithoutMovingFocus,
      contains: (node) =>
        !!node && (!!root.current?.contains(node) || !!panel.current?.contains(node)),
      closest: (selector) => root.current?.closest(selector) ?? null,
      focusTrigger: () => triggerRef.current?.focus(),
    }),
    [open, closeWithoutMovingFocus, root, triggerRef],
  );
  useEffect(() => {
    const node = root.current;
    node?.addEventListener("baro-disclosure-close", closeWithoutMovingFocus);
    return () => node?.removeEventListener("baro-disclosure-close", closeWithoutMovingFocus);
  }, [closeWithoutMovingFocus, root]);
  return (
    <>
      <PopoverButton
        as={Button}
        ref={triggerRef}
        variant="ghost"
        size="icon"
        className="rounded-full"
        data-disclosure-button=""
        aria-label="자료 추가 및 멘션"
        title="자료 추가 및 멘션"
        onKeyDown={handleKeys}
      >
        <Plus size={20} aria-hidden="true" />
      </PopoverButton>
      <PopoverPanel
        ref={panel}
        portal
        anchor={{ to: "top start", gap: 10, padding: 12 }}
        data-product-ui=""
        data-theme={theme}
        data-product-composer-menu-panel=""
        onKeyDown={handleKeys}
        className="z-[80] w-80 max-w-[calc(100vw-24px)] space-y-2 overflow-auto rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-2 text-[var(--pui-text)] shadow-lg [max-height:min(45dvh,380px)] focus:outline-none"
      >
        {children(closeWithoutMovingFocus)}
      </PopoverPanel>
    </>
  );
}

/** The handle includes the portaled panel so the owner's existing outside check
 * and close calls retain their meaning without moving selection state here. */
export function ComposerAddMenu({ ref, triggerRef, children }: Props) {
  const ready = useClientReady();
  const root = useRef<HTMLDivElement>(null);
  if (!ready)
    return (
      <div data-product-composer-menu="" data-disclosure="" className="col-start-1 row-start-2">
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon"
          data-disclosure-button=""
          aria-label="자료 추가 및 멘션"
          disabled
        >
          <Plus size={20} aria-hidden="true" />
        </Button>
      </div>
    );
  return (
    <Popover
      ref={root}
      data-product-composer-menu=""
      data-disclosure=""
      className="col-start-1 row-start-2"
    >
      {({ open, close }) => (
        <MenuContents open={open} close={close} root={root} ref={ref} triggerRef={triggerRef}>
          {children}
        </MenuContents>
      )}
    </Popover>
  );
}
