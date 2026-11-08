import type { ReactNode } from "react";
import { Dialog } from "../ui/dialog";
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
    <Dialog
      open
      title={title}
      showCloseButton={false}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      {busy && (
        <p role="status" className="ui-loading__label">
          <Spinner />
          {busyLabel ?? "요청을 처리하고 있어요…"}
        </p>
      )}
      {children}
    </Dialog>
  );
}
