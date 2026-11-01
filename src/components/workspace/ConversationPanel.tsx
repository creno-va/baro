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
      const visible =
        target?.isConnected && target.getClientRects().length > 0
          ? target
          : target?.closest("details")?.querySelector<HTMLElement>("summary");
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
        if ((event.target as Element).closest("dialog[open]")) return;
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
