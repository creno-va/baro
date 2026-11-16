import { LoaderCircle, Send } from "lucide-react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { Button } from "../Button";

export type ConversationComposerProps = {
  formProps: Pick<ComponentPropsWithRef<"form">, "onSubmit" | "onDragOver" | "onDrop" | "onPaste">;
  textareaProps: Omit<ComponentPropsWithRef<"textarea">, "className" | "style" | "children">;
  attachments?: ReactNode;
  uploadConsent?: ReactNode;
  uploadFeedback?: ReactNode;
  mentions?: ReactNode;
  addMenu: ReactNode;
  sendDisabled: boolean;
  sending: boolean;
};

/** The owner supplies native event handlers and all mutation state. */
export function ConversationComposer({
  formProps,
  textareaProps,
  attachments,
  uploadConsent,
  uploadFeedback,
  mentions,
  addMenu,
  sendDisabled,
  sending,
}: ConversationComposerProps) {
  const id = textareaProps.id ?? "workspace-message";
  return (
    <form
      {...formProps}
      noValidate
      data-product-composer=""
      className="mx-auto max-h-[min(45dvh,380px)] w-full max-w-[832px] min-w-0 shrink-0 overflow-y-auto bg-[var(--pui-surface)] px-2.5 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pb-3"
    >
      <div
        data-product-composer-surface=""
        className="rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-2 focus-within:border-[var(--pui-focus)]"
      >
        {attachments}
        {uploadConsent}
        {uploadFeedback}
        {mentions}
        <div
          data-product-composer-row=""
          className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)_44px] grid-rows-[46px_44px] gap-x-2 gap-y-1"
        >
          <label className="sr-only" htmlFor={id}>
            추가 사실 또는 질문
          </label>
          <textarea
            {...textareaProps}
            id={id}
            className="col-span-3 col-start-1 row-start-1 block h-[46px] min-h-[46px] w-full min-w-0 resize-none overflow-y-auto rounded-lg border-0 bg-transparent px-2 py-2.5 text-base leading-[26px] text-[var(--pui-text)] placeholder:text-[var(--pui-muted)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--pui-focus)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:outline-[var(--pui-danger)]"
          />
          {addMenu}
          <Button
            data-product-composer-send=""
            className="col-start-3 row-start-2 rounded-full"
            type="submit"
            size="icon"
            aria-label={sending ? "저장 중" : "보내기"}
            aria-busy={sending || undefined}
            disabled={sendDisabled}
          >
            {sending ? (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                size={18}
                aria-hidden="true"
              />
            ) : (
              <Send size={18} aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
