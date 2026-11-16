import { X } from "lucide-react";
import { Button } from "../Button";
import type { useConversationPanelController } from "./useConversationPanelController";

export function PanelView({
  id,
  heading,
  title,
  busy,
  onClose,
  children,
  onKeyDown,
}: ReturnType<typeof useConversationPanelController>) {
  return (
    // .conversation-panel is the existing recheck focus boundary, not a style dependency.
    <section
      data-product-conversation-panel=""
      className="conversation-panel m-0 min-w-0 max-w-full space-y-4 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-4 text-[var(--pui-text)] [overflow-wrap:anywhere] sm:p-5"
      aria-labelledby={id}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--pui-border)] pb-3">
        <h3
          ref={heading}
          id={id}
          tabIndex={-1}
          className="min-w-0 rounded-lg text-base font-semibold leading-7 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pui-focus)]"
        >
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
