import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "../ui/button";

/** One inline work area, with the conversation and composer kept in place. */
export function ConversationPanel({
  title,
  busy,
  onClose,
  returnFocus,
  canRestoreFocus,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  returnFocus: HTMLElement | null;
  canRestoreFocus?: () => boolean;
  children: ReactNode;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef(returnFocus);
  const restore = useRef(canRestoreFocus);
  restore.current = canRestoreFocus;
  useEffect(() => {
    if (
      busy ||
      !heading.current?.isConnected ||
      document.activeElement !== document.body ||
      document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') ||
      (restore.current && !restore.current())
    )
      return;
    // A completed child can replace its focused controls. Restore this stable
    // reading target only if no other control or modal owns the user's focus.
    heading.current.focus({ preventScroll: true });
  }, [busy]);
  useEffect(() => {
    const messages = heading.current?.closest<HTMLElement>(".workspace-messages");
    if (!messages) return;
    const handleScrollEscape = (event: KeyboardEvent) => {
      if (
        event.target !== messages ||
        event.key !== "Escape" ||
        event.defaultPrevented ||
        busy ||
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') ||
        (restore.current && !restore.current())
      )
        return;
      // Native WebKit button interactions can retain this keyboard-scrollable
      // ancestor as their reading target. Close its current pane without moving
      // focus away from any other control, pane, or native modal.
      event.preventDefault();
      onClose();
    };
    messages.addEventListener("keydown", handleScrollEscape);
    return () => messages.removeEventListener("keydown", handleScrollEscape);
  }, [busy, onClose]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const messages = heading.current?.closest(".workspace-messages");
    if (messages && heading.current)
      messages.scrollTo({
        top:
          messages.scrollTop +
          heading.current.getBoundingClientRect().top -
          messages.getBoundingClientRect().top -
          12,
        behavior: "instant",
      });
    else heading.current?.scrollIntoView({ block: "nearest" });
    return () => {
      const target = origin.current;
      if (restore.current && !restore.current()) return;
      if (target?.closest("[inert], [aria-hidden='true']")) return;
      const focusable =
        target &&
        target !== document.body &&
        target !== document.documentElement &&
        !target.matches(".workspace-messages, main, [role='main']") &&
        !target.matches(":disabled, [aria-disabled='true']") &&
        (target.tabIndex >= 0 || target.hasAttribute("tabindex") || target.isContentEditable);
      const visible =
        focusable && target.isConnected && target.getClientRects().length > 0
          ? target
          : target
              ?.closest("[data-disclosure]")
              ?.querySelector<HTMLElement>("[data-disclosure-button]");
      (
        visible ?? document.querySelector<HTMLTextAreaElement>("#workspace-message:not(:disabled)")
      )?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <section
      className="conversation-panel"
      aria-labelledby={id}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || busy) return;
        if ((event.target as Element).closest('dialog[open], [role="dialog"][aria-modal="true"]'))
          return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="conversation-panel-heading">
        <h3 ref={heading} id={id} tabIndex={-1}>
          {title}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label="대화 작업 닫기"
          onClick={onClose}
        >
          <X size={19} aria-hidden="true" />
        </Button>
      </div>
      {children}
    </section>
  );
}
