import type { ReactNode } from "react";
import { Modal } from "../ui/dialog";
import { Spinner } from "../ui/loading";
export function ConfirmDialog({
  title,
  children,
  busy,
  busyLabel,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  busyLabel?: string;
  onCancel: () => void;
}) {
  return (
    <Modal
      open
      title={title}
      onClose={() => {
        if (!busy) onCancel();
      }}
      className="report-modal"
      aria-busy={busy}
    >
      <h2>{title}</h2>
      {busy && (
        <p role="status" className="ui-loading__label">
          <Spinner />
          {busyLabel ?? "요청을 처리하고 있어요…"}
        </p>
      )}
      {children}
    </Modal>
  );
}
