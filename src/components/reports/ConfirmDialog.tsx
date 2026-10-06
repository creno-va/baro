import { type ReactNode, useEffect, useId, useRef } from "react";
export function ConfirmDialog({
  title,
  children,
  busy,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      queueMicrotask(() => {
        if (previous?.isConnected) previous.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="report-modal"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  );
}
